declare const Il2Cpp: any;
declare const console: any;

var _wasdMovementEnabled = true;
var _wasdOverlayEditing = false;

Il2Cpp.perform(() => {
    try {
        const CoreModule = Il2Cpp.domain.assembly("UnityEngine.CoreModule").image;
        const AC         = Il2Cpp.domain.assembly("AnimalCompany").image;

        let RigidbodyClass: any = null;
        for (const asmName of ["UnityEngine.Physics", "UnityEngine.PhysicsModule", "UnityEngine.CoreModule"]) {
            try { RigidbodyClass = Il2Cpp.domain.assembly(asmName).image.class("UnityEngine.Rigidbody"); break; } catch(_) {}
        }

        const getDelta = CoreModule.class("UnityEngine.Time").method("get_deltaTime");

        // ── Windows API — bypasses Unity's input system entirely ─────────────
        const user32           = Process.findModuleByName("user32.dll")!;
        const GetAsyncKeyState = new NativeFunction(user32.findExportByName("GetAsyncKeyState")!, "int16",  ["int"]);
        const GetCursorPos     = new NativeFunction(user32.findExportByName("GetCursorPos")!,     "bool",   ["pointer"]);
        const SetCursorPos     = new NativeFunction(user32.findExportByName("SetCursorPos")!,     "bool",   ["int", "int"]);
        const GetSystemMetrics = new NativeFunction(user32.findExportByName("GetSystemMetrics")!, "int",    ["int"]);

        // Virtual key codes
        const VK_W = 0x57, VK_A = 0x41, VK_S = 0x53, VK_D = 0x44;
        const VK_SPACE = 0x20, VK_LSHIFT = 0xA0, VK_LCTRL = 0xA2, VK_ESC = 0x1B;
        const VK_BACK = 0x08;

        const MOVE_SPEED       = 10.0;  // normal speed
        const MOVE_SPEED_BOOST = 200.0;  // speed when Space held
        const MOUSE_SENS = 0.15;  // pixels → degrees

        // Screen centre for mouse delta
        const screenW   = GetSystemMetrics(0) as number;
        const screenH   = GetSystemMetrics(1) as number;
        const cx        = Math.floor(screenW / 2);
        const cy        = Math.floor(screenH / 2);
        const cursorBuf = Memory.alloc(8);

        let yaw = 0.0, pitch = 0.0, rotInitialized = false;
        let smoothDx = 0.0, smoothDy = 0.0;
        let flyY: number | null = null;
        let cursorLocked = false;  // ESC toggles this
        let prevEsc      = false;  // edge-detect so one press = one toggle
        let prevBackspace = false;

        // Unity Cursor API for show/hide
        let UnityCursor: any = null;
        try { UnityCursor = CoreModule.class("UnityEngine.Cursor"); } catch(_) {}

        function applyCursorState(locked: boolean) {
            try {
                if (UnityCursor) {
                    UnityCursor.method("set_lockState").invoke(locked ? 2 : 0); // Locked=2 None=0
                    UnityCursor.method("set_visible").invoke(!locked);
                }
            } catch(_) {}
            if (locked) SetCursorPos(cx, cy);
        }

        function isKeyDown(vk: number): boolean {
            return ((GetAsyncKeyState(vk) as number) & 0x8001) !== 0;
        }

        // ── Hook point ────────────────────────────────────────────────────────
        const GorillaLocomotion = AC.class("AnimalCompany.GorillaLocomotion");
        const PlayerController  = AC.class("AnimalCompany.PlayerController");

        let hookAddr: any = null;
        for (const [klass, name] of [
            [GorillaLocomotion, "LateUpdate"],
            [GorillaLocomotion, "Update"],
            [PlayerController,  "LateUpdate"],
            [PlayerController,  "Update"],
            [GorillaLocomotion, "FixedUpdate"],
            [PlayerController,  "FixedUpdate"],
        ] as [any, string][]) {
            try {
                const addr = klass.method(name).virtualAddress;
                if (addr && !addr.isNull()) {
                    hookAddr = addr;
                    console.log(`[wasd] Hooked ${name}`);
                    break;
                }
            } catch(_) {}
        }

        if (!hookAddr) { console.error("[wasd] No hook found"); return; }

        // Interceptor.attach — runs our code alongside the original, no .invoke() needed
        Interceptor.attach(hookAddr, function(_args) {
            try {
                const dt = getDelta.invoke() as number;

                let gtPlayer: any = null;
                try { gtPlayer = GorillaLocomotion.field("<Instance>k__BackingField").value; } catch(_) {}
                if (!gtPlayer || gtPlayer.isNull()) return;

                // Kill Rigidbody physics every frame — stops gravity drift and hand glitching
                if (RigidbodyClass) {
                    try {
                        const rb = gtPlayer.method("GetComponent", 1).inflate(RigidbodyClass).invoke();
                        if (rb && !rb.isNull()) {
                            rb.method("set_isKinematic").invoke(true);
                            rb.method("set_useGravity").invoke(false);
                            rb.method("set_velocity").invoke([0, 0, 0]);
                            rb.method("set_angularVelocity").invoke([0, 0, 0]);
                        }
                    } catch(_) {}
                }

                const playerTr = gtPlayer.method("get_transform").invoke();
                if (!playerTr || playerTr.isNull()) return;

                const pos = playerTr.method("get_position").invoke();
                const px  = pos.field("x").value as number;
                const py  = pos.field("y").value as number;
                const pz  = pos.field("z").value as number;

                // Seed flyY on first frame (or after a large teleport)
                if (flyY === null || Math.abs(py - flyY) > 3.0) flyY = py;

                // ── ESC: toggle cursor lock ──────────────────────────────────
                const esc = isKeyDown(VK_ESC);
                if (esc && !prevEsc) {
                    cursorLocked = !cursorLocked;
                    applyCursorState(cursorLocked);
                    console.log(`[wasd] Cursor ${cursorLocked ? "locked — mouse controls camera" : "unlocked — free cursor"}`);
                }
                prevEsc = esc;

                // ── Mouse look (only when cursor is locked) ───────────────────
                if (!rotInitialized) {
                    const e = playerTr.method("get_eulerAngles").invoke();
                    yaw = e.field("y").value as number;
                    rotInitialized = true;
                }

                if (cursorLocked) {
                    GetCursorPos(cursorBuf);
                    const rawX = cursorBuf.readS32() - cx;
                    const rawY = cursorBuf.add(4).readS32() - cy;
                    SetCursorPos(cx, cy);

                    // Smooth out single-frame jitter; 0.85 weight on new input keeps it responsive
                    smoothDx = smoothDx * 0.15 + rawX * 0.85;
                    smoothDy = smoothDy * 0.15 + rawY * 0.85;
                    yaw   += smoothDx * MOUSE_SENS;
                    pitch += smoothDy * MOUSE_SENS;
                    pitch  = Math.max(-80, Math.min(80, pitch));

                    playerTr.method("set_eulerAngles").invoke([0, yaw, 0]);

                    try {
                        const head = gtPlayer.field("headCollider").value;
                        if (head && !head.isNull()) {
                            const ht = head.method("get_transform").invoke();
                            if (ht && !ht.isNull()) ht.method("set_localEulerAngles").invoke([pitch, 0, 0]);
                        }
                    } catch(_) {}
                }

                // ── Backspace: toggle WASD on/off ──────────────────────────────
                const backspace = isKeyDown(VK_BACK);
                if (backspace && !prevBackspace) {
                    _wasdMovementEnabled = !_wasdMovementEnabled;
                    console.log(`[wasd] WASD movement ${_wasdMovementEnabled ? "ENABLED" : "DISABLED"}`);
                }
                prevBackspace = backspace;

                // ── Movement (skip when WASD disabled or editing text) ────────
                if (_wasdMovementEnabled && !_wasdOverlayEditing) {
                    const w     = isKeyDown(VK_W);
                    const a     = isKeyDown(VK_A);
                    const s     = isKeyDown(VK_S);
                    const d     = isKeyDown(VK_D);
                    const boost = isKeyDown(VK_SPACE);
                    const up    = isKeyDown(VK_LSHIFT);
                    const down  = isKeyDown(VK_LCTRL);
                    const speed = boost ? MOVE_SPEED_BOOST : MOVE_SPEED;

                    // Vertical fly — update flyY, then force position to flyY every frame
                    if (up)   flyY += speed * dt;
                    if (down) flyY -= speed * dt;

                    // Horizontal
                    let mx = 0, mz = 0;
                    if (w || a || s || d) {
                        let fx = 0, fz = 0, rx = 0, rz = 0;
                        try {
                            const head   = gtPlayer.field("headCollider").value;
                            const headTr = head.method("get_transform").invoke();
                            const fwd    = headTr.method("get_forward").invoke();
                            const rgt    = headTr.method("get_right").invoke();
                            fx = fwd.field("x").value as number; fz = fwd.field("z").value as number;
                            rx = rgt.field("x").value as number; rz = rgt.field("z").value as number;
                        } catch(_) {
                            const fwd = playerTr.method("get_forward").invoke();
                            const rgt = playerTr.method("get_right").invoke();
                            fx = fwd.field("x").value as number; fz = fwd.field("z").value as number;
                            rx = rgt.field("x").value as number; rz = rgt.field("z").value as number;
                        }

                        const fLen = Math.sqrt(fx * fx + fz * fz);
                        if (fLen > 0.001) { fx /= fLen; fz /= fLen; }
                        const rLen = Math.sqrt(rx * rx + rz * rz);
                        if (rLen > 0.001) { rx /= rLen; rz /= rLen; }

                        if (w) { mx += fx; mz += fz; }
                        if (s) { mx -= fx; mz -= fz; }
                        if (d) { mx += rx; mz += rz; }
                        if (a) { mx -= rx; mz -= rz; }

                        const mLen = Math.sqrt(mx * mx + mz * mz);
                        if (mLen > 0.001) { mx = (mx / mLen) * speed * dt; mz = (mz / mLen) * speed * dt; }
                    }

                    // Apply — flyY overrides physics gravity every frame
                    playerTr.method("set_position").invoke([px + mx, flyY, pz + mz]);
                }

            } catch(e) {
                console.error("[wasd] frame error:", e);
            }
        });

        console.log("[wasd] FCS SKID WASD v1.00.0 loaded — WASD movement active");
    } catch(e) {
        console.error("[wasd] Init failed:", e);
    }
});
