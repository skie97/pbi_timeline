export function formatReg2Spec(reg: string) : string {
    let x: string = reg.replace(/dd/g, "D");
    x = x.replace(/d/g, "%_d");
    x = x.replace(/D/g, "%d");
    
    x = x.replace(/mmm/g, "%b");
    x = x.replace(/mm/g, "%m");

    x = x.replace(/yyyy/d, "%Y");
    x = x.replace(/yy/g, "%y");

    x = x.replace(/hh/g, "%H");
    x = x.replace(/nn/g, "%M");

    return x;
}