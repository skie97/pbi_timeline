/*
*  Power BI Visual CLI
*
*  Copyright (c) Microsoft Corporation
*  All rights reserved.
*  MIT License
*
*  Permission is hereby granted, free of charge, to any person obtaining a copy
*  of this software and associated documentation files (the ""Software""), to deal
*  in the Software without restriction, including without limitation the rights
*  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
*  copies of the Software, and to permit persons to whom the Software is
*  furnished to do so, subject to the following conditions:
*
*  The above copyright notice and this permission notice shall be included in
*  all copies or substantial portions of the Software.
*
*  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
*  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
*  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
*  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
*  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
*  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
*  THE SOFTWARE.
*/
"use strict";

import "core-js/stable";
import "./../style/visual.less";
import powerbi from "powerbi-visuals-api";
import "regenerator-runtime/runtime"; // This is required for tooltips to work!

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import EnumerateVisualObjectInstancesOptions = powerbi.EnumerateVisualObjectInstancesOptions;
import VisualObjectInstance = powerbi.VisualObjectInstance;
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;
import DataView = powerbi.DataView;
import DataViewTable = powerbi.DataViewTable;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import {createTooltipServiceWrapper, ITooltipServiceWrapper, TooltipEventArgs} from "powerbi-visuals-utils-tooltiputils";
import VisualObjectInstanceEnumerationObject = powerbi.VisualObjectInstanceEnumerationObject;
import * as d3 from "d3";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
type Selection<T extends d3.BaseType> = d3.Selection<T, any, any, any>;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;
import ISelectionId = powerbi.visuals.ISelectionId;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import { dataRoleHelper } from "powerbi-visuals-utils-dataviewutils";
import { getValue, getCategoricalObjectValue } from "./objectEnumerationUtility";
import VisualEnumerationInstanceKinds = powerbi.VisualEnumerationInstanceKinds;
import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";
import Fill = powerbi.Fill;
import { textMeasurementService as tms } from "powerbi-visuals-utils-formattingutils";

import {color, Primitive} from "d3";
import { TextProperties } from "powerbi-visuals-utils-formattingutils/lib/src/interfaces";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

interface BarViewModel {
    data: BarData[];
    minDate: Date;
    maxDate: Date;
    labelSettings: {};
    settings: BarSettings;
    yaxis_width: number;
}

interface BarData {
    startDate: Date;
    endDate: Date;
    category: string;
    label: string;
    selectionId: ISelectionId;
    color: BarLabelSetting;
}

interface BarLabelSetting{
    name: string;
    color: string;
    selectionId: ISelectionId;
}

interface BarSettings {
    yAxis: {
        fontSize: number;
        width: number;
    }

    xAxis: {
        fontSize: number;
        showMonthDay: boolean;
        showYear: boolean;
    }

    label: {
        fontSize: number;
    }
}

let defaultSettings: BarSettings = {
    yAxis: {
        fontSize: 20,
        width: 100,
    },
    xAxis: {
        fontSize: 14,
        showMonthDay: false,
        showYear: true,
    },
    label: {
        fontSize: 14,
    }
}

function getTableViewIndex(metaDataCols: DataViewMetadataColumn[], roleName: string): number {
    for (let col of metaDataCols) {
        if (roleName in col.roles) {
            return col.index
        }
    }
    return null;
}

function visualTransform(options: VisualUpdateOptions, host: IVisualHost): BarViewModel {
    let dataViews = options.dataViews;
    let viewModel: BarViewModel = {
        data: [],
        labelSettings: <BarLabelSetting>{},
        minDate: new Date(),
        maxDate: new Date(),
        settings: <BarSettings>{},
        yaxis_width: 0
    }

    if (!dataViews
        || !dataViews[0]
        || !dataViews[0].table
        || !dataViews[0].table.columns
        || !dataViews[0].table.rows
        || dataViews[0].table.columns.length != 4) {
        return viewModel;
    }

    const tableDataview: DataViewTable = dataViews[0].table;
    let catIndex = getTableViewIndex(dataViews[0].metadata.columns,"category");
    let labelIndex = getTableViewIndex(dataViews[0].metadata.columns,"label");
    let startDateIndex = getTableViewIndex(dataViews[0].metadata.columns,"startDate");
    let endDateIndex = getTableViewIndex(dataViews[0].metadata.columns,"endDate");

    let colorPalette: ISandboxExtendedColorPalette = host.colorPalette;
    let objects = dataViews[0].metadata.objects;

    let barSettings: BarSettings = {
        yAxis: {
            width: getValue<number>(objects, 'yAxis', 'width', defaultSettings.yAxis.width),
            fontSize: getValue<number>(objects, 'yAxis', 'fontSize', defaultSettings.yAxis.fontSize)
        },
        xAxis: {
            fontSize: getValue<number>(objects, 'xAxis', 'fontSize', defaultSettings.xAxis.fontSize),
            showMonthDay: getValue<boolean>(objects, 'xAxis', 'showMonthDay', defaultSettings.xAxis.showMonthDay),
            showYear: getValue<boolean>(objects, 'xAxis', 'showYear', defaultSettings.xAxis.showYear),
        },
        label: {
            fontSize: getValue<number>(objects, 'label', 'fontSize', defaultSettings.xAxis.fontSize)
        }
    }

    // For table mappings to have a custom color for each "category" a special trick needs to be employed.
    // you need to do an additional mapping to a category as well. Take note that all the
    // values need to be selected, but the resultant dataView object will not have any data values.
    // That's ok as we are getting the values from the table mapping.
    // What's important is that this allows for another SelectionId to be created, and this time
    // on the regular categorial item. There is however a need to figure out a reverse index
    // to ensure that the correct categories are selected.
    // The other trick is to map each of the datapoint's color to an object, so that the color
    // is set from this top level setting. Hope that explains it sufficiently.
    // All values need to be selected otherwise the table mapping doesn't work properly.

    let category = dataViews[0].categorical.categories[0];
    let reverseCatIdx = {};
    for (let i = 0; i < category.values.length; i++) {
        reverseCatIdx[String(category.values[i])] = i;
    }

    tableDataview.rows.forEach((row: powerbi.DataViewTableRow, rowIndex: number) => {
        let labelText = String(row[labelIndex]);
        if (!(labelText in viewModel.labelSettings)) {
            viewModel.labelSettings[labelText] = {
                name: labelText,
                color: getColumnColorByIndex(category, reverseCatIdx[labelText], colorPalette),
                selectionId: host.createSelectionIdBuilder()
                    .withCategory(category, reverseCatIdx[labelText])
                    .createSelectionId()
            }
        }
        let txtProp: TextProperties = {
            fontFamily: "sans-serif",
            fontSize: barSettings.yAxis.fontSize.toString() + "pt",
        }
        let bar:BarData = {
            category: String(row[catIndex]),
            label: String(row[labelIndex]),
            startDate: new Date(<string>row[startDateIndex]),
            endDate: new Date(<string>row[endDateIndex]),
            selectionId: host.createSelectionIdBuilder()
                .withTable(tableDataview, rowIndex)
                .createSelectionId(),
            color: viewModel.labelSettings[labelText]
        }
        viewModel.data.push(bar);
        viewModel.minDate = viewModel.minDate < bar.startDate ? viewModel.minDate : bar.startDate;
        viewModel.maxDate = viewModel.maxDate > bar.endDate ? viewModel.maxDate : bar.endDate;
        viewModel.yaxis_width = viewModel.yaxis_width < tms.measureSvgTextWidth(txtProp, bar.category) ? tms.measureSvgTextWidth(txtProp, bar.category) : viewModel.yaxis_width;
    });

    viewModel.data.sort((a,b) => {
        if (a.category < b.category) return -1;
        if (a.category > b.category) return 1;
        return 0;
    })
    // This is a hack to align the setting to the calculated width. 
    // The setting was removed, but all bindings still in place. Change this to revert.
    barSettings.yAxis.width = viewModel.yaxis_width; 
    viewModel.settings = barSettings;
    return viewModel;
}

function getColumnColorByIndex(
    category: DataViewCategoryColumn,
    index: number,
    colorPalette: ISandboxExtendedColorPalette,
): string {
    if (colorPalette.isHighContrast) {
        return colorPalette.background.value;
    }

    const defaultColor: Fill = {
        solid: {
            color: colorPalette.getColor(`${category.values[index]}`).value,
        }
    };

    return getCategoricalObjectValue<Fill>(
        category,
        index,
        'colorSelector',
        'fill',
        defaultColor
    ).solid.color;
}

function blackOrWhite(color: d3.RGBColor): string { // https://stackoverflow.com/questions/35969656/how-can-i-generate-the-opposite-color-according-to-current-color
    return (color.r * 0.299 + color.g * 0.587 + color.b * 0.114) > 186 ? '#000000' : '#FFFFFF';
}

export class Visual implements IVisual {
    private svg: Selection<SVGElement>;
    private timelineContainer: Selection<SVGElement>;
    private host: IVisualHost;
    private yAxis: Selection<SVGElement>;
    private xAxis: Selection<SVGElement>;
    private xAxis_Gridlines: Selection<SVGElement>;
    private selectionManager: ISelectionManager;
    private tooltipServiceWrapper: ITooltipServiceWrapper;
    private datapointSelection: d3.Selection<d3.BaseType, any, d3.BaseType, any>;
    private barSettings: BarSettings;
    private barLabelSetting: {};

    constructor(options: VisualConstructorOptions) {
        this.svg = d3.select(options.element).append('svg');
        this.host = options.host;
        this.selectionManager = options.host.createSelectionManager();
        this.selectionManager.registerOnSelectCallback(() => {
            this.syncSelectionState(this.datapointSelection, <ISelectionId[]>this.selectionManager.getSelectionIds());
        });
        // Creating the tooltipServiceWrapper. There is an important import statement at the top. Check the comments.
        this.tooltipServiceWrapper = createTooltipServiceWrapper(this.host.tooltipService, options.element);
        
        // This is the main container for all d3 visuals
        this.timelineContainer = this.svg.append("g");
        
        // Adding the Axis and gridlines
        this.yAxis = this.svg
            .append('g')
            .classed('yAxis', true);
        this.xAxis = this.svg
            .append('g')
            .classed('xAxis', true);
        this.xAxis_Gridlines = this.svg
            .append('g')
            .classed('grid', true);
    }

    public update(options: VisualUpdateOptions) {
        const viewModel: BarViewModel = visualTransform(options, this.host);
        let settings = this.barSettings = viewModel.settings;
        this.barLabelSetting = viewModel.labelSettings;

        if(viewModel.data.length == 0){
            this.timelineContainer.remove();
            this.timelineContainer = this.svg.append("g");
            return;
        }
        let width = options.viewport.width;
        let height = options.viewport.height;
        this.svg.attr('width', width)
            .attr('height', height);

        let y = d3.scaleBand()
            .domain(viewModel.data.map(d => d.category))
            .rangeRound([0, height - settings.xAxis.fontSize - 8])
            .padding(0.2);

        let x = d3.scaleTime()
            .domain([viewModel.minDate, viewModel.maxDate])
            .range([settings.yAxis.width, width-10]);
        
        let yAxis = d3.axisLeft(y);
        let xAxis = d3.axisBottom(x);

        this.yAxis.attr('transform', 'translate(' 
            + settings.yAxis.width + ',0)')
            .style("font-size", settings.yAxis.fontSize)
            .call(yAxis);
        this.xAxis.attr('transform', 'translate(0,' 
            + (height - settings.xAxis.fontSize - 10) + ')')
            .style("font-size", settings.xAxis.fontSize)
            .call(xAxis.tickFormat(settings.xAxis.showMonthDay ? (settings.xAxis.showYear ? d3.timeFormat("%d %b %y") : d3.timeFormat("%d %b")) : d3.timeFormat("%b %y")));
        this.xAxis_Gridlines.attr('transform', 'translate(0,' 
            + (height - settings.xAxis.fontSize - 10) + ')')
            .call(xAxis.tickSize(-height).tickFormat((d,i) => ""));
        
        let bars = this.timelineContainer
            .selectAll('.bar')
            .data(viewModel.data);
        
        let barsMerged = bars.enter()
            .append('g').classed('bar',true)
        
        barsMerged.append("rect").classed("box", true);
        barsMerged.append("text").classed("label", true);

        barsMerged = barsMerged.merge(<any>bars);
        
        barsMerged.select('.box')
            .attr("width", d => x(d.endDate) - x(d.startDate))
            .attr("x", d => x(d.startDate))
            .attr("height", y.bandwidth())
            .attr("y", d => y(d.category))
            .style("fill-opacity", 0.8)
            .style("fill", d => d.color.color)
            .style("stroke", "black")
            .style("stroke-width", 2);

        barsMerged.select('.label')
            .attr("x", d => x(d.startDate) + (x(d.endDate) - x(d.startDate))/2)
            .attr("y", d => y(d.category) + y.bandwidth() - (settings.label.fontSize/2))
            .text(d => d.label)
            .style("fill", d => blackOrWhite(d3.color(d.color.color).rgb()))
            .style("font-size", settings.label.fontSize)
            .style("text-anchor", "middle");

        this.tooltipServiceWrapper.addTooltip(barsMerged,
            (datapoint: BarData) => this.getTooltipData(datapoint),
            (datapoint: BarData) => datapoint.selectionId
        );

        this.syncSelectionState( // This helper function is called to ensure that the elements take selection into account.
                barsMerged,
                <ISelectionId[]>this.selectionManager.getSelectionIds()
            );
    
        barsMerged.on('click', (d) => {        
            this.selectionManager
                .select(d.selectionId)
                .then((ids: ISelectionId[]) => { // Important step to ensure that the selection is displayed. Otherwise it is only refreshed on another update.
                    this.syncSelectionState(barsMerged, ids);
                    // NOTE: in the default project creation of pbiviz
                    // @types/d3 5.7.21 will pull in the latest d3-selection v2 which is wrong.
                    // because of the link @types/d3-selection@* instead of @types/d3-selection@^1
                    // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/48407
                    // Thus the d3.event will be missing.
                })
        });

        bars.exit().remove();
    }

    /**
     * This function gets called for each of the objects defined in the capabilities files and allows you to select which of the
     * objects and properties you want to expose to the users in the property pane.
     *
     */
    public enumerateObjectInstances(options: EnumerateVisualObjectInstancesOptions): VisualObjectInstance[] | VisualObjectInstanceEnumerationObject {
        let objectName = options.objectName;
        let objectEnumeration: VisualObjectInstance[] = [];

        if (!this.barSettings ||
            !this.barLabelSetting) {
            return objectEnumeration;
        }
        switch (objectName) {
            case 'colorSelector':
                for (let labelColor in this.barLabelSetting) {
                    objectEnumeration.push({
                        objectName: objectName,
                        displayName: this.barLabelSetting[labelColor].name,
                        properties: {
                            fill: {
                                solid: {
                                    color: this.barLabelSetting[labelColor].color
                                }
                            }
                        },
                        // propertyInstanceKind: {
                        //     fill: VisualEnumerationInstanceKinds.ConstantOrRule
                        // },
                        // altConstantValueSelector: this.barLabelSetting[labelColor].selectionId.getSelector(),
                        // selector: dataViewWildcard.createDataViewWildcardSelector(dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals)
                        selector: this.barLabelSetting[labelColor].selectionId.getSelector()
                    });
                }
                break;
                case 'xAxis':
                    objectEnumeration.push({
                        objectName: objectName,
                        properties: {
                            fontSize: this.barSettings.xAxis.fontSize,
                            showMonthDay: this.barSettings.xAxis.showMonthDay,
                            showYear: this.barSettings.xAxis.showYear,
                        },
                        selector: null
                    });
                    break;
                case 'yAxis':
                    objectEnumeration.push({
                        objectName: objectName,
                        properties: {
                            fontSize: this.barSettings.yAxis.fontSize,
                            // width: this.barSettings.yAxis.width,
                        },
                        selector: null
                    });
                    break;
                case 'label':
                    objectEnumeration.push({
                        objectName: objectName,
                        properties: {
                            fontSize: this.barSettings.label.fontSize
                        },
                        selector: null
                    });
                    break;
        };

        return objectEnumeration;
    }

    private syncSelectionState(
        selection: d3.Selection<any,BarData,any,BarData>,
        selectionIds: ISelectionId[]
    ): void {
        if (!selection || !selectionIds) {
            return;
        }

        if (!selectionIds.length) {
            const opacity: number = 1; // TODO: To store value in the settings. And pass settings object in.
            selection.select('.box')
                .style("fill-opacity", opacity)

            return;
        }

        const self: this = this;

        selection.each(function (bar: BarData) {
            const isSelected: boolean = self.isSelectionIdInArray(selectionIds, bar.selectionId);

            const opacity: number = isSelected
                ? 1.0 // This is hardcoded now, by can set in the settings? Need to modify the function to have the setting variable passed in.
                : 0.15;

            d3.select(this).select('.box')
                .style("fill-opacity", opacity)
        });
    }

    private formatDateForTooltip(d: Date): String {
        return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear() % 100} (${weekdayNames[d.getDay()]})`
    }

    private getTooltipData(value: any): VisualTooltipDataItem[] {
        return [{
            displayName: `${value.label}`,
            value: `${this.formatDateForTooltip(value.startDate)} – ${this.formatDateForTooltip(value.endDate)} [${(value.endDate - value.startDate) / (1000 * 3600 * 24)} days]`,
            header: `${value.category}`
        }];
    }

    // Unmodified helper function.
    private isSelectionIdInArray(selectionIds: ISelectionId[], selectionId: ISelectionId): boolean {
        if (!selectionIds || !selectionId) {
            return false;
        }

        return selectionIds.some((currentSelectionId: ISelectionId) => {
            return currentSelectionId.includes(selectionId);
        });
    }
}