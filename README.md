# [Power BI] Custom Timeline Visual
One of the things that I find myself doing repeatedly is coming up with powerpoint slides to show a timeline of events. This gets rather annoying as the boilerplate activity to make everything scale correctly is quite tedious.

I have created this visual to help others visualise this data easily. Currently though, the labels are automatically coloured using the colour palette that had been chosen. Custom colours seems to be difficult as I'm probably doing something wrong with the *enumerateObjectInstances* function when the format objects are enumerated. I think I'm not binding it correctly.

Anyhow, the visual works and is a good first cut.

## Update: 21 Jun 21
For table mappings to have a custom color for each "category" a special trick needs to be employed. You need to do an additional mapping to a category as well. Take note that all the values need to be selected, but the resultant dataView object will not have any data values. That's ok as we are getting the values from the table mapping. What's important is that this allows for another SelectionId to be created, and this time on the regular categorial item. There is however a need to figure out a reverse index to ensure that the correct categories are selected. The other trick is to map each of the datapoint's color to an object, so that the color is set from this top level setting. Hope that explains it sufficiently. All values need to be selected otherwise the table mapping doesn't work properly.

### TODO:
- ~~Custom colours for different labels~~