// @ts-nocheck
// SteamVR Bypass — spoofs VR headset status so game runs on PC
// Uses tryAssembly() to avoid broken domain.assemblies enumeration
Il2Cpp.perform(() => {
    try {
        console.log("[+] VR Bypass By Sunny");
        const asm = Il2Cpp.domain.tryAssembly("AnimalCompany");
        if (!asm) { console.log("[-] AnimalCompany assembly not found"); return; }
        const image = asm.image;
        const appUtils = image.tryClass("AnimalCompany.AppUtils");
        if (!appUtils) { console.log("[-] AppUtils not found"); return; }

        const steamVRStatus = image.tryClass("AnimalCompany.AppUtils+SteamVRHeadsetStatus");
        const getXRBackend = appUtils.method("GetXRBackend");
        const getSteamVRHeadsetStatus = appUtils.method("GetSteamVRHeadsetStatus");

        appUtils.method("IsSteamVRHeadsetActive").implementation = function () {
            return true;
        };

        getXRBackend.implementation = function () {
            return 2;
        };

        getSteamVRHeadsetStatus.implementation = function () {
            if (!steamVRStatus) return null;
            const status = steamVRStatus.new().unbox();
            status.field("activeLoaderPresent").value = true;
            status.field("xrDisplayRunning").value = true;
            status.field("headDeviceValid").value = true;
            status.field("userPresenceKnown").value = true;
            status.field("userPresent").value = true;
            return status;
        };

        console.log("[+] SteamVR Bypass loaded!");
    } catch (e) {
        console.log("[-] SteamVR Bypass failed: " + e);
    }
});
