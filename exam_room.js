// exam_room.js - Universal Realtime Room Control & Proctoring for VSTEP Mock Tests
// Supports: Writing, Speaking, Reading, Listening, VSTEP Mock Tests
// Powered by Firebase Realtime Database (vstep6868)
(function () {
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyD6DtRnCJ-jaFjYcyztdSE1JxatUXAIO2M",
        authDomain: "vstep6868.firebaseapp.com",
        databaseURL: "https://vstep6868-default-rtdb.firebaseio.com",
        projectId: "vstep6868",
        storageBucket: "vstep6868.firebasestorage.app",
        messagingSenderId: "232760826079",
        appId: "1:232760826079:web:2318f85e69bf8b582a316a",
        measurementId: "G-8DVJNZ7DBZ"
    };

    const RTDB_BASE = "https://vstep6868-default-rtdb.firebaseio.com";

    const SKILLS_CONFIG = {
        writing: {
            node: "room_writing",
            title: "PHÒNG THI VIẾT (WRITING)",
            short: "Viết",
            icon: "fa-pen-nib"
        },
        speaking: {
            node: "room_speaking",
            title: "PHÒNG THI NÓI (SPEAKING)",
            short: "Nói",
            icon: "fa-microphone"
        },
        reading: {
            node: "room_reading",
            title: "PHÒNG THI ĐỌC (READING)",
            short: "Đọc",
            icon: "fa-book-open"
        },
        listening: {
            node: "room_listening",
            title: "PHÒNG THI NGHE (LISTENING)",
            short: "Nghe",
            icon: "fa-headphones"
        },
        vstep: {
            node: "room_vstep",
            title: "PHÒNG THI VSTEP TỔNG HỢP",
            short: "Vstep",
            icon: "fa-graduation-cap"
        }
    };

    // Auto-detect current skill
    function detectSkill() {
        if (window.VSTEP_ROOM_SKILL && SKILLS_CONFIG[window.VSTEP_ROOM_SKILL]) {
            return window.VSTEP_ROOM_SKILL;
        }
        const path = (window.location.pathname || "").toLowerCase();
        const title = (document.title || "").toLowerCase();
        const combined = path + " " + title;

        if (combined.includes("speaking") || combined.includes("nói")) return "speaking";
        if (combined.includes("reading") || combined.includes("đọc")) return "reading";
        if (combined.includes("listening") || combined.includes("nghe")) return "listening";
        if (combined.includes("mocktests") || combined.includes("tổng hợp")) return "vstep";
        if (combined.includes("writing") || combined.includes("viết")) return "writing";
        return "writing";
    }

    const currentSkillKey = detectSkill();
    const currentSkill = SKILLS_CONFIG[currentSkillKey];

    // Local room states
    const allRoomsState = {
        writing: { isOpen: true, allowedTest: "all" },
        speaking: { isOpen: true, allowedTest: "all" },
        reading: { isOpen: true, allowedTest: "all" },
        listening: { isOpen: true, allowedTest: "all" },
        vstep: { isOpen: true, allowedTest: "all" }
    };

    let fbApp = null;
    let rtdb = null;
    let isInitialized = false;

    // Helper: Teacher account identification
    function isTeacherUser(name, className) {
        const n = String(name || "").trim().toLowerCase();
        const c = String(className || "").trim().toUpperCase();
        if (c === "GV") return true;
        if (/^(ptmn|gv|cô nguyệt|co nguyet|phạm thị minh nguyệt|pham thi minh nguyet|giáo viên|giao vien|teacher|miss nguyet)$/i.test(n)) return true;
        if (n.includes("ptmn") || n.includes("cô nguyệt") || n.includes("co nguyet") || n.includes("giáo viên") || n.includes("giao vien") || n.includes("teacher")) return true;
        return false;
    }

    function getCurrentUserInfo() {
        const name = localStorage.getItem("vstep_student_name") || sessionStorage.getItem("vstep_student_name") || "";
        const className = localStorage.getItem("vstep_student_class") || sessionStorage.getItem("vstep_student_class") || "";
        return {
            name,
            className,
            isTeacher: isTeacherUser(name, className)
        };
    }

    function getCurrentTestNumber() {
        const path = window.location.pathname;
        const match = path.match(/test\s*(\d+)|test0?(\d+)/i);
        if (match) {
            return parseInt(match[1] || match[2], 10);
        }
        if (typeof window.TEST_NUMBER !== "undefined") {
            return parseInt(window.TEST_NUMBER, 10);
        }
        return 0; // Homepage or all
    }

    // --- Inject Styles ---
    function injectStyles() {
        if (document.getElementById("vstep-exam-room-styles")) return;
        const style = document.createElement("style");
        style.id = "vstep-exam-room-styles";
        style.innerHTML = `
            /* Teacher Floating Control Bar */
            .vstep-teacher-bar-wrapper {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 9999999;
                background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%);
                color: #ffffff;
                box-shadow: 0 4px 25px rgba(0, 0, 0, 0.45);
                border-bottom: 2px solid rgba(234, 179, 8, 0.7);
                font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
                animation: slideDownBar 0.35s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes slideDownBar {
                from { transform: translateY(-100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .vstep-teacher-bar-content {
                max-width: 1400px;
                margin: 0 auto;
                padding: 8px 18px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px;
            }
            .teacher-bar-left {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            .teacher-bar-badge {
                background: linear-gradient(135deg, #f59e0b, #d97706);
                color: #ffffff;
                padding: 4px 10px;
                border-radius: 999px;
                font-size: 11px;
                font-weight: 800;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                gap: 5px;
                box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
            }
            .teacher-room-status-pill {
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 4px 12px;
                border-radius: 999px;
                font-size: 12px;
                font-weight: 700;
                transition: all 0.25s ease;
            }
            .teacher-room-status-pill.open {
                background: rgba(34, 197, 94, 0.2);
                border: 1px solid #22c55e;
                color: #4ade80;
            }
            .teacher-room-status-pill.closed {
                background: rgba(239, 68, 68, 0.2);
                border: 1px solid #ef4444;
                color: #f87171;
            }
            .teacher-status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                display: inline-block;
            }
            .teacher-room-status-pill.open .teacher-status-dot {
                background: #22c55e;
                box-shadow: 0 0 10px #22c55e;
                animation: pulseDot 1.8s infinite;
            }
            .teacher-room-status-pill.closed .teacher-status-dot {
                background: #ef4444;
                box-shadow: 0 0 10px #ef4444;
            }
            @keyframes pulseDot {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.3); }
            }
            .teacher-bar-center {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }
            .teacher-select-label {
                font-size: 12px;
                font-weight: 600;
                color: #cbd5e1;
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .teacher-test-select {
                background: rgba(15, 23, 42, 0.85);
                color: #ffffff;
                border: 1px solid rgba(148, 163, 184, 0.4);
                padding: 5px 12px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                outline: none;
            }
            /* Multiselect Checkbox Dropdown */
            .teacher-multiselect-container {
                position: relative;
                display: inline-block;
            }
            .teacher-multiselect-toggle {
                background: rgba(15, 23, 42, 0.85);
                color: #ffffff;
                border: 1px solid rgba(148, 163, 184, 0.4);
                padding: 5px 12px;
                border-radius: 8px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                outline: none;
                display: flex;
                align-items: center;
                gap: 7px;
                transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .teacher-multiselect-toggle:hover {
                border-color: #38bdf8;
                background: rgba(15, 23, 42, 0.95);
            }
            .teacher-dropdown-arrow {
                font-size: 10px;
                margin-left: 3px;
                transition: transform 0.2s ease;
                color: #94a3b8;
            }
            .teacher-dropdown-menu {
                position: absolute;
                top: calc(100% + 8px);
                left: 0;
                width: 320px;
                background: #0f172a;
                border: 1.5px solid rgba(56, 189, 248, 0.5);
                border-radius: 12px;
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.7), 0 0 20px rgba(56, 189, 248, 0.2);
                padding: 12px;
                z-index: 999999999;
                animation: teacherDropIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes teacherDropIn {
                from { opacity: 0; transform: translateY(-6px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            .teacher-dropdown-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 8px;
                padding-bottom: 6px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .teacher-dropdown-title {
                font-size: 11px;
                font-weight: 800;
                color: #38bdf8;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .teacher-dropdown-close {
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 18px;
                line-height: 1;
                cursor: pointer;
                padding: 0 4px;
                border-radius: 4px;
            }
            .teacher-dropdown-close:hover {
                color: #ffffff;
                background: rgba(255, 255, 255, 0.1);
            }
            .teacher-dropdown-actions {
                display: flex;
                gap: 8px;
                margin-bottom: 10px;
            }
            .btn-quick-select {
                flex: 1;
                background: rgba(255, 255, 255, 0.08);
                color: #e2e8f0;
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 6px;
                padding: 5px 8px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 5px;
                transition: all 0.15s ease;
            }
            .btn-quick-select:hover {
                background: rgba(56, 189, 248, 0.2);
                border-color: #38bdf8;
                color: #ffffff;
            }
            .teacher-checkbox-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 6px;
                max-height: 220px;
                overflow-y: auto;
                padding-right: 4px;
            }
            .teacher-checkbox-grid::-webkit-scrollbar {
                width: 5px;
            }
            .teacher-checkbox-grid::-webkit-scrollbar-thumb {
                background: rgba(148, 163, 184, 0.3);
                border-radius: 4px;
            }
            .teacher-test-checkbox-label {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 8px;
                background: rgba(30, 41, 59, 0.7);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                cursor: pointer;
                font-size: 11.5px;
                font-weight: 600;
                color: #cbd5e1;
                user-select: none;
                transition: all 0.15s ease;
            }
            .teacher-test-checkbox-label:hover {
                background: rgba(56, 189, 248, 0.15);
                border-color: rgba(56, 189, 248, 0.4);
                color: #ffffff;
            }
            .teacher-test-checkbox-label.checked {
                background: rgba(14, 165, 233, 0.25);
                border-color: #0284c7;
                color: #38bdf8;
            }
            .teacher-test-checkbox {
                display: none;
            }
            .custom-check-box {
                width: 14px;
                height: 14px;
                border-radius: 3px;
                border: 1px solid #64748b;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 9px;
                color: transparent;
                background: rgba(15, 23, 42, 0.6);
                flex-shrink: 0;
                transition: all 0.15s ease;
            }
            .teacher-test-checkbox-label.checked .custom-check-box {
                background: #0284c7;
                border-color: #38bdf8;
                color: #ffffff;
            }
            .test-label-text {
                font-size: 11.5px;
            }
            .teacher-dropdown-footer {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 10px;
                padding-top: 8px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
                font-size: 11px;
                color: #94a3b8;
            }
            .btn-done-select {
                background: linear-gradient(135deg, #0284c7, #0369a1);
                color: #fff;
                border: none;
                padding: 4px 12px;
                border-radius: 6px;
                font-weight: 700;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.15s ease;
            }
            .btn-done-select:hover {
                background: linear-gradient(135deg, #0369a1, #075985);
            }
            .teacher-btn-action {
                border: none;
                border-radius: 8px;
                padding: 6px 14px;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            }
            .teacher-btn-action:hover {
                transform: translateY(-1px);
            }
            .btn-toggle-room.open {
                background: linear-gradient(135deg, #dc2626, #b91c1c);
                color: #ffffff;
                box-shadow: 0 2px 10px rgba(220, 38, 38, 0.35);
            }
            .btn-toggle-room.closed {
                background: linear-gradient(135deg, #16a34a, #15803d);
                color: #ffffff;
                box-shadow: 0 2px 10px rgba(22, 163, 74, 0.35);
            }
            .btn-emergency-collect {
                background: linear-gradient(135deg, #e11d48, #be123c);
                color: #ffffff;
                box-shadow: 0 2px 10px rgba(225, 29, 72, 0.4);
            }

            /* Quick room indicators for other skills */
            .teacher-other-skills {
                display: flex;
                align-items: center;
                gap: 6px;
                padding-left: 10px;
                border-left: 1px solid rgba(255, 255, 255, 0.15);
                flex-wrap: wrap;
            }
            .other-skills-label {
                font-size: 11px;
                color: #94a3b8;
                font-weight: 600;
            }
            .skill-chip-btn {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.15);
                color: #e2e8f0;
                border-radius: 6px;
                padding: 3px 8px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                transition: all 0.2s ease;
            }
            .skill-chip-btn:hover {
                background: rgba(255, 255, 255, 0.18);
            }
            .skill-chip-btn.is-active-skill {
                border-color: #f59e0b;
                box-shadow: 0 0 8px rgba(245, 158, 11, 0.35);
            }
            .skill-chip-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                display: inline-block;
            }
            .skill-chip-dot.open { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
            .skill-chip-dot.closed { background: #ef4444; box-shadow: 0 0 6px #ef4444; }

            /* Room Closed Warning Alert on Test Screen */
            .vstep-room-closed-box {
                max-width: 550px;
                margin: 20px auto 10px;
                padding: 16px 22px;
                border-radius: 14px;
                background: linear-gradient(135deg, #fff1f2 0%, #fee2e2 100%);
                border: 1.5px solid #fca5a5;
                color: #991b1b;
                text-align: center;
                box-shadow: 0 8px 24px rgba(239, 68, 68, 0.12);
                animation: shakeAlert 0.4s ease;
            }
            @keyframes shakeAlert {
                0%, 100% { transform: translateX(0); }
                20%, 60% { transform: translateX(-4px); }
                40%, 80% { transform: translateX(4px); }
            }
            .room-closed-icon { font-size: 26px; color: #ef4444; margin-bottom: 6px; }
            .room-closed-title { font-size: 15px; font-weight: 800; margin: 0 0 5px; color: #991b1b; }
            .room-closed-desc { font-size: 13px; line-height: 1.5; margin: 0; color: #7f1d1d; font-weight: 500; }

            .btn-start-test.room-locked, button.room-locked {
                background: linear-gradient(135deg, #94a3b8, #64748b) !important;
                border-color: #64748b !important;
                color: #f1f5f9 !important;
                cursor: not-allowed !important;
                box-shadow: none !important;
                transform: none !important;
                opacity: 0.85 !important;
            }

            /* Emergency Modal when Teacher closes room during active test */
            .vstep-emergency-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(15, 23, 42, 0.85);
                backdrop-filter: blur(12px);
                z-index: 99999999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                animation: fadeInModal 0.3s ease;
            }
            @keyframes fadeInModal {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .vstep-emergency-card {
                background: #ffffff;
                border-radius: 20px;
                padding: 32px 28px;
                max-width: 480px;
                width: 100%;
                text-align: center;
                box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4);
                border: 2px solid #ef4444;
            }
            .emergency-icon {
                width: 65px;
                height: 65px;
                background: #fee2e2;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 15px;
                color: #ef4444;
                font-size: 30px;
            }
            .emergency-title { font-size: 19px; font-weight: 800; color: #991b1b; margin: 0 0 10px; }
            .emergency-desc { font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px; }
            .btn-view-solution {
                background: linear-gradient(135deg, #6366f1, #4f46e5);
                color: #ffffff;
                border: none;
                border-radius: 10px;
                padding: 12px 26px;
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
            }

            body.has-teacher-bar { padding-top: 54px !important; }
        `;
        document.head.appendChild(style);
    }

    // --- Test Selection Helpers ---
    function parseAllowedTests(allowedVal) {
        if (!allowedVal || allowedVal === "all") return "all";
        if (allowedVal === "none" || allowedVal === "") return [];
        if (Array.isArray(allowedVal)) {
            return allowedVal.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        }
        return String(allowedVal)
            .split(",")
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n));
    }

    function isTestNumberAllowed(testNum, allowedVal) {
        if (!testNum || testNum <= 0) return true; // Homepage or general page
        const parsed = parseAllowedTests(allowedVal);
        if (parsed === "all") return true;
        if (Array.isArray(parsed)) {
            return parsed.includes(testNum);
        }
        return true;
    }

    function isTestChecked(n, allowedVal) {
        const parsed = parseAllowedTests(allowedVal);
        if (parsed === "all") return true;
        if (Array.isArray(parsed)) {
            return parsed.includes(n);
        }
        return false;
    }

    function getDisplayTextForAllowed(allowedVal) {
        const parsed = parseAllowedTests(allowedVal);
        if (parsed === "all") return "Mở tất cả đề thi";
        if (Array.isArray(parsed)) {
            if (parsed.length === 0) return "Khóa tất cả đề";
            if (parsed.length === 17) return "Mở tất cả đề thi";
            if (parsed.length === 1) {
                const p = parsed[0] < 10 ? '0' + parsed[0] : parsed[0];
                return `Chỉ mở Đề ${p}`;
            }
            if (parsed.length <= 3) {
                const formatted = parsed.map(n => n < 10 ? '0' + n : n).join(', ');
                return `Mở Đề: ${formatted}`;
            }
            return `Mở ${parsed.length} đề (Đề ${parsed.slice(0, 2).map(n => n < 10 ? '0' + n : n).join(', ')}...)`;
        }
        return "Mở tất cả đề thi";
    }

    function getSelectedSummaryText(allowedVal) {
        const parsed = parseAllowedTests(allowedVal);
        if (parsed === "all") return "Đang chọn: 17/17 đề (Tất cả)";
        if (Array.isArray(parsed)) {
            return `Đang chọn: ${parsed.length}/17 đề`;
        }
        return "Đang chọn: Tất cả";
    }

    // --- Render Teacher Floating Control Bar ---
    function renderTeacherBar() {
        const userInfo = getCurrentUserInfo();
        if (!userInfo.isTeacher) {
            const existing = document.getElementById("vstep-teacher-room-bar");
            if (existing) existing.remove();
            document.body.classList.remove("has-teacher-bar");
            return;
        }

        let bar = document.getElementById("vstep-teacher-room-bar");
        if (!bar) {
            bar = document.createElement("div");
            bar.id = "vstep-teacher-room-bar";
            bar.className = "vstep-teacher-bar-wrapper";
            document.body.prepend(bar);
            document.body.classList.add("has-teacher-bar");
        }

        const currentRoom = allRoomsState[currentSkillKey] || { isOpen: true, allowedTest: "all" };
        const isOpen = currentRoom.isOpen !== false;
        const allowed = currentRoom.allowedTest || "all";

        bar.innerHTML = `
            <div class="vstep-teacher-bar-content">
                <div class="teacher-bar-left">
                    <span class="teacher-bar-badge"><i class="fa-solid fa-chalkboard-user"></i> CÔ NGUYỆT</span>
                    <div class="teacher-room-status-pill ${isOpen ? 'open' : 'closed'}">
                        <span class="teacher-status-dot"></span>
                        <span>${currentSkill.short.toUpperCase()}: ${isOpen ? 'ĐANG MỞ' : 'ĐANG ĐÓNG'}</span>
                    </div>
                </div>

                <div class="teacher-bar-center">
                    <label class="teacher-select-label">
                        <i class="fa-solid fa-layer-group"></i> Đề:
                    </label>
                    <div class="teacher-multiselect-container" id="teacher-test-dropdown-container">
                        <button type="button" class="teacher-multiselect-toggle" id="teacher-test-toggle" onclick="VstepExamRoom.toggleTestDropdown(event)" title="Nhấn để chọn các đề được mở thi">
                            <i class="fa-solid fa-list-check" style="color: #38bdf8;"></i>
                            <span class="teacher-multiselect-text" id="teacher-multiselect-text">${getDisplayTextForAllowed(allowed)}</span>
                            <i class="fa-solid fa-chevron-down teacher-dropdown-arrow" id="teacher-dropdown-arrow"></i>
                        </button>

                        <div class="teacher-dropdown-menu" id="teacher-test-dropdown-menu" style="display: none;" onclick="event.stopPropagation()">
                            <div class="teacher-dropdown-header">
                                <span class="teacher-dropdown-title">
                                    <i class="fa-solid fa-filter"></i> CHỌN ĐỀ ĐƯỢC MỞ THI:
                                </span>
                                <button type="button" class="teacher-dropdown-close" onclick="VstepExamRoom.closeTestDropdown(event)">&times;</button>
                            </div>

                            <div class="teacher-dropdown-actions">
                                <button type="button" class="btn-quick-select" onclick="VstepExamRoom.selectAllTests(true)">
                                    <i class="fa-solid fa-check-double"></i> Mở tất cả
                                </button>
                                <button type="button" class="btn-quick-select" onclick="VstepExamRoom.selectAllTests(false)">
                                    <i class="fa-solid fa-xmark"></i> Bỏ chọn hết
                                </button>
                            </div>

                            <div class="teacher-checkbox-grid">
                                ${[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17].map(n => {
                                    const isChk = isTestChecked(n, allowed);
                                    const padNum = n < 10 ? '0' + n : n;
                                    return `
                                        <label class="teacher-test-checkbox-label ${isChk ? 'checked' : ''}" onclick="event.stopPropagation()">
                                            <input type="checkbox" class="teacher-test-checkbox" value="${n}" ${isChk ? 'checked' : ''} onchange="VstepExamRoom.onCheckboxChange(this)">
                                            <span class="custom-check-box"><i class="fa-solid fa-check"></i></span>
                                            <span class="test-label-text">Đề ${padNum}</span>
                                        </label>
                                    `;
                                }).join('')}
                            </div>

                            <div class="teacher-dropdown-footer">
                                <span class="teacher-selected-summary" id="teacher-selected-summary">
                                    ${getSelectedSummaryText(allowed)}
                                </span>
                                <button type="button" class="btn-done-select" onclick="VstepExamRoom.closeTestDropdown(event)">
                                    <i class="fa-solid fa-check"></i> Xong
                                </button>
                            </div>
                        </div>
                    </div>

                    <button type="button" class="teacher-btn-action btn-toggle-room ${isOpen ? 'open' : 'closed'}" onclick="VstepExamRoom.toggleCurrentRoom()">
                        <i class="fa-solid ${isOpen ? 'fa-lock' : 'fa-lock-open'}"></i>
                        <span>${isOpen ? 'Đóng Phòng ' + currentSkill.short : 'Mở Phòng ' + currentSkill.short}</span>
                    </button>

                    <button type="button" class="teacher-btn-action btn-emergency-collect" onclick="VstepExamRoom.emergencyCollect()" title="Thu bài và khóa phòng ngay">
                        <i class="fa-solid fa-bell"></i>
                        <span>Thu Bài & Khóa</span>
                    </button>
                </div>

                <div class="teacher-other-skills">
                    <span class="other-skills-label">CÁC PHÒNG:</span>
                    ${Object.keys(SKILLS_CONFIG).map(sk => {
                        const sCfg = SKILLS_CONFIG[sk];
                        const sState = allRoomsState[sk] || { isOpen: true };
                        const sOpen = sState.isOpen !== false;
                        const isThis = sk === currentSkillKey;
                        return `
                            <button type="button" class="skill-chip-btn ${isThis ? 'is-active-skill' : ''}" onclick="VstepExamRoom.toggleSpecificRoom('${sk}')" title="Nhấn để Bật/Tắt phòng ${sCfg.short}">
                                <i class="fa-solid ${sCfg.icon}"></i>
                                <span>${sCfg.short}</span>
                                <span class="skill-chip-dot ${sOpen ? 'open' : 'closed'}"></span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    // --- Apply State to Student Experience ---
    function applyRoomState() {
        const userInfo = getCurrentUserInfo();
        if (userInfo.isTeacher) {
            renderTeacherBar();
            restoreStudentAccess();
            return;
        }

        const currentRoom = allRoomsState[currentSkillKey] || { isOpen: true, allowedTest: "all" };
        const currentTest = getCurrentTestNumber();
        const isOpen = currentRoom.isOpen !== false;
        const allowed = currentRoom.allowedTest || "all";

        let isThisTestAllowed = true;
        let blockedReason = "";

        if (!isOpen) {
            isThisTestAllowed = false;
            blockedReason = `Phòng thi ${currentSkill.title} hiện đang ĐÓNG. Vui lòng chờ Giáo viên (Cô Nguyệt) mở phòng để vào làm bài!`;
        } else if (!isTestNumberAllowed(currentTest, allowed)) {
            isThisTestAllowed = false;
            const parsed = parseAllowedTests(allowed);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const formatted = parsed.map(n => n < 10 ? '0' + n : String(n)).join(', ');
                blockedReason = `Hôm nay lớp chỉ mở các ĐỀ: ${formatted}. Đề thi này hiện chưa được mở!`;
            } else if (Array.isArray(parsed) && parsed.length === 0) {
                blockedReason = `Phòng thi hiện đang tạm khóa tất cả các đề. Vui lòng chờ Giáo viên mở đề!`;
            } else {
                blockedReason = `Đề thi này hiện chưa được mở!`;
            }
        }

        if (!isThisTestAllowed) {
            enforceStudentBlock(blockedReason);
        } else {
            restoreStudentAccess();
        }
    }

    function enforceStudentBlock(reasonText) {
        // 1. Writing Mock Tests (isExamRunning)
        if (typeof isExamRunning !== "undefined" && isExamRunning) {
            if (typeof submitTest === "function") {
                submitTest(true);
            } else {
                isExamRunning = false;
                if (typeof timerInterval !== "undefined" && timerInterval) clearInterval(timerInterval);
            }
            showEmergencyClosedModal(reasonText);
            return;
        }

        // 2. Speaking Mock Tests (currentScreen !== 'welcome' && currentScreen !== 'review')
        if (typeof currentScreen !== "undefined" && currentScreen !== "welcome" && currentScreen !== "review") {
            if (typeof enterReview === "function") {
                enterReview();
            }
            showEmergencyClosedModal(reasonText);
            return;
        }

        // 3. Reading Mock Tests (state.activeExam && state.activeExam.test && !state.activeExam.isSubmitted)
        if (typeof state !== "undefined" && state.activeExam && state.activeExam.test && !state.activeExam.isSubmitted) {
            if (typeof submitExam === "function") {
                submitExam();
            }
            showEmergencyClosedModal(reasonText);
            return;
        }

        // 4. Listening Mock Tests (window.VSTEP_IS_LISTENING_RUNNING / VSTEP_SUBMIT_LISTENING)
        if (typeof window.VSTEP_IS_LISTENING_RUNNING === "function" && window.VSTEP_IS_LISTENING_RUNNING()) {
            if (typeof window.VSTEP_SUBMIT_LISTENING === "function") {
                window.VSTEP_SUBMIT_LISTENING();
            }
            showEmergencyClosedModal(reasonText);
            return;
        }

        // 5. VSTEP Mock Tests (mocktests - DOM.examScreen && DOM.examScreen.classList.contains("active"))
        if (typeof DOM !== "undefined" && DOM.examScreen && DOM.examScreen.classList.contains("active")) {
            if (typeof submitExam === "function") {
                submitExam();
            }
            showEmergencyClosedModal(reasonText);
            return;
        }

        // On welcome screen start buttons
        const startBtns = document.querySelectorAll("#btn-start-test, #btn-start-exam, .btn-practice-cbt, .btn-start");
        startBtns.forEach(btn => {
            btn.disabled = true;
            btn.classList.add("room-locked");
            btn.dataset.origHtml = btn.dataset.origHtml || btn.innerHTML;
            btn.innerHTML = `<i class="fa-solid fa-lock"></i> PHÒNG THI ĐANG ĐÓNG`;
            btn.title = reasonText;
        });

        // Show room closed notice box
        const targetBtn = document.querySelector("#btn-start-test, #btn-start-exam, .btn-practice-cbt, .btn-start");
        if (targetBtn && targetBtn.parentElement) {
            let noticeBox = document.getElementById("vstep-room-closed-alert");
            if (!noticeBox) {
                noticeBox = document.createElement("div");
                noticeBox.id = "vstep-room-closed-alert";
                noticeBox.className = "vstep-room-closed-box";
                targetBtn.parentElement.parentElement.insertBefore(noticeBox, targetBtn.parentElement);
            }
            noticeBox.style.display = "block";
            noticeBox.innerHTML = `
                <div class="room-closed-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                <h4 class="room-closed-title">PHÒNG THI TẠM THỜI ĐÓNG</h4>
                <p class="room-closed-desc">${reasonText}</p>
            `;
        }
    }

    function restoreStudentAccess() {
        const startBtns = document.querySelectorAll("#btn-start-test, #btn-start-exam, .btn-practice-cbt, .btn-start");
        startBtns.forEach(btn => {
            if (btn.classList.contains("room-locked")) {
                btn.disabled = false;
                btn.classList.remove("room-locked");
                if (btn.dataset.origHtml) {
                    btn.innerHTML = btn.dataset.origHtml;
                } else {
                    btn.innerHTML = `BẮT ĐẦU LÀM BÀI <i class="fa-solid fa-play"></i>`;
                }
            }
        });

        const noticeBox = document.getElementById("vstep-room-closed-alert");
        if (noticeBox) {
            noticeBox.style.display = "none";
        }
    }

    function showEmergencyClosedModal(reasonText) {
        if (document.getElementById("vstep-emergency-modal")) return;
        const modal = document.createElement("div");
        modal.id = "vstep-emergency-modal";
        modal.className = "vstep-emergency-overlay";
        modal.innerHTML = `
            <div class="vstep-emergency-card">
                <div class="emergency-icon"><i class="fa-solid fa-bell"></i></div>
                <h3 class="emergency-title">GIÁO VIÊN ĐÃ THU BÀI & KHÓA PHÒNG</h3>
                <p class="emergency-desc">${reasonText || 'Thời gian làm bài đã kết thúc hoặc Giáo viên đã đóng phòng thi. Bài làm của bạn đã được hệ thống lưu lại an toàn.'}</p>
                <button type="button" class="btn-view-solution" onclick="document.getElementById('vstep-emergency-modal').remove()">
                    <i class="fa-solid fa-check"></i> Đã Hiểu
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // --- Realtime DB Sync & REST Polling ---
    function initFirebase() {
        if (isInitialized) return;
        isInitialized = true;

        injectStyles();

        // 1. Firebase Compat SDK
        if (typeof firebase !== "undefined" && firebase.initializeApp) {
            try {
                if (!firebase.apps.length) {
                    fbApp = firebase.initializeApp(FIREBASE_CONFIG);
                } else {
                    fbApp = firebase.app();
                }
                rtdb = firebase.database();

                // Listen to ALL room nodes for teacher control
                Object.keys(SKILLS_CONFIG).forEach(sk => {
                    const nodeName = SKILLS_CONFIG[sk].node;
                    rtdb.ref(nodeName).on("value", snapshot => {
                        const data = snapshot.val();
                        if (data) {
                            allRoomsState[sk] = data;
                            applyRoomState();
                        }
                    });
                });
            } catch (e) {
                console.log("Firebase RTDB init note:", e);
                fetchAllRoomsREST();
            }
        } else {
            fetchAllRoomsREST();
        }

        // Periodic REST Polling every 8 seconds as resilient backup
        setInterval(fetchAllRoomsREST, 8000);

        renderTeacherBar();
    }

    function fetchAllRoomsREST() {
        fetch(`${RTDB_BASE}/.json`, { cache: "no-store" })
            .then(res => res.json())
            .then(data => {
                if (!data) return;
                Object.keys(SKILLS_CONFIG).forEach(sk => {
                    const nodeName = SKILLS_CONFIG[sk].node;
                    if (data[nodeName]) {
                        allRoomsState[sk] = data[nodeName];
                    }
                });
                applyRoomState();
            })
            .catch(() => {});
    }

    function updateRoomInFirebase(skillKey, patchData) {
        patchData.updatedAt = Date.now();
        patchData.updatedBy = "Cô Nguyệt (PTMN)";

        allRoomsState[skillKey] = { ...(allRoomsState[skillKey] || {}), ...patchData };
        applyRoomState();

        const nodeName = SKILLS_CONFIG[skillKey].node;

        if (rtdb) {
            rtdb.ref(nodeName).update(patchData).catch(() => {});
            // Backward compatibility for writing room
            if (skillKey === "writing") {
                rtdb.ref("room_control").update(patchData).catch(() => {});
            }
        }

        fetch(`${RTDB_BASE}/${nodeName}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patchData)
        }).catch(() => {});

        if (skillKey === "writing") {
            fetch(`${RTDB_BASE}/room_control.json`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patchData)
            }).catch(() => {});
        }
    }

    // --- Public API ---
    window.VstepExamRoom = {
        init: initFirebase,
        getCurrentSkill: () => currentSkillKey,
        getRoomState: (skillKey) => allRoomsState[skillKey || currentSkillKey],

        canStudentStartExam(skillKey) {
            const userInfo = getCurrentUserInfo();
            if (userInfo.isTeacher) return true;

            const room = allRoomsState[skillKey || currentSkillKey] || { isOpen: true, allowedTest: "all" };
            const currentTest = getCurrentTestNumber();

            if (room.isOpen === false) return false;
            if (!isTestNumberAllowed(currentTest, room.allowedTest)) {
                return false;
            }
            return true;
        },

        toggleCurrentRoom() {
            const current = allRoomsState[currentSkillKey] || { isOpen: true };
            const nextIsOpen = !(current.isOpen !== false);
            updateRoomInFirebase(currentSkillKey, {
                isOpen: nextIsOpen,
                message: nextIsOpen ? `Phòng thi ${currentSkill.short} đang mở` : `Phòng thi ${currentSkill.short} hiện đang đóng`
            });
            alert(nextIsOpen 
                ? `🟢 ĐÃ MỞ PHÒNG THI ${currentSkill.title}!` 
                : `🔴 ĐÃ KHÓA PHÒNG THI ${currentSkill.title}!`);
        },

        toggleSpecificRoom(skillKey) {
            if (!SKILLS_CONFIG[skillKey]) return;
            const targetCfg = SKILLS_CONFIG[skillKey];
            const current = allRoomsState[skillKey] || { isOpen: true };
            const nextIsOpen = !(current.isOpen !== false);
            updateRoomInFirebase(skillKey, {
                isOpen: nextIsOpen,
                message: nextIsOpen ? `Phòng thi ${targetCfg.short} đang mở` : `Phòng thi ${targetCfg.short} hiện đang đóng`
            });
            alert(nextIsOpen 
                ? `🟢 ĐÃ MỞ: ${targetCfg.title}!` 
                : `🔴 ĐÃ KHÓA: ${targetCfg.title}!`);
        },

        toggleTestDropdown(e) {
            if (e) e.stopPropagation();
            const menu = document.getElementById("teacher-test-dropdown-menu");
            const arrow = document.getElementById("teacher-dropdown-arrow");
            if (!menu) return;
            const isVisible = menu.style.display === "block";
            menu.style.display = isVisible ? "none" : "block";
            if (arrow) {
                arrow.style.transform = isVisible ? "rotate(0deg)" : "rotate(180deg)";
            }
        },

        closeTestDropdown(e) {
            if (e) e.stopPropagation();
            const menu = document.getElementById("teacher-test-dropdown-menu");
            const arrow = document.getElementById("teacher-dropdown-arrow");
            if (menu) menu.style.display = "none";
            if (arrow) arrow.style.transform = "rotate(0deg)";
        },

        selectAllTests(shouldSelectAll) {
            const checkboxes = document.querySelectorAll(".teacher-test-checkbox");
            checkboxes.forEach(cb => {
                cb.checked = shouldSelectAll;
                const parentLabel = cb.closest(".teacher-test-checkbox-label");
                if (parentLabel) parentLabel.classList.toggle("checked", shouldSelectAll);
            });
            this.syncSelectionFromDOM();
        },

        onCheckboxChange(cb) {
            const parentLabel = cb.closest(".teacher-test-checkbox-label");
            if (parentLabel) parentLabel.classList.toggle("checked", cb.checked);
            this.syncSelectionFromDOM();
        },

        syncSelectionFromDOM() {
            const checkboxes = Array.from(document.querySelectorAll(".teacher-test-checkbox"));
            const selectedNums = checkboxes
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.value, 10))
                .sort((a, b) => a - b);
            
            let allowedVal;
            let msg;
            if (selectedNums.length === checkboxes.length) {
                allowedVal = "all";
                msg = "Mở tất cả đề thi";
            } else if (selectedNums.length === 0) {
                allowedVal = "none";
                msg = "Khóa tất cả đề thi";
            } else if (selectedNums.length === 1) {
                allowedVal = String(selectedNums[0]);
                msg = `Chỉ mở Đề ${selectedNums[0] < 10 ? '0' + selectedNums[0] : selectedNums[0]}`;
            } else {
                allowedVal = selectedNums.join(",");
                const formatted = selectedNums.map(n => n < 10 ? '0' + n : n).join(', ');
                msg = `Mở các Đề: ${formatted}`;
            }

            // Update label and summary immediately
            const labelEl = document.getElementById("teacher-multiselect-text");
            if (labelEl) labelEl.textContent = getDisplayTextForAllowed(allowedVal);
            const summaryEl = document.getElementById("teacher-selected-summary");
            if (summaryEl) summaryEl.textContent = getSelectedSummaryText(allowedVal);

            // Save to Firebase immediately
            updateRoomInFirebase(currentSkillKey, {
                allowedTest: allowedVal,
                message: msg
            });
        },

        onTeacherChangeTest(val) {
            updateRoomInFirebase(currentSkillKey, {
                allowedTest: val,
                message: val === "all" ? "Mở tất cả đề thi" : `Chỉ mở Đề ${val}`
            });
        },

        emergencyCollect() {
            const confirmAction = confirm(`⚠️ CẢNH BÁO PHÒNG THI:\n\nCô có chắc chắn muốn KHÓA PHÒNG & THU BÀI của học viên phòng ${currentSkill.title} ngay bây giờ không?`);
            if (!confirmAction) return;

            updateRoomInFirebase(currentSkillKey, {
                isOpen: false,
                message: `Giáo viên đã thu bài và đóng ${currentSkill.title}!`
            });
            alert(`🚨 ĐÃ THU BÀI TOÀN BỘ PHÒNG ${currentSkill.short.toUpperCase()}!`);
        },

        refreshUI() {
            renderTeacherBar();
            applyRoomState();
        }
    };

    // Close test multiselect dropdown when clicking outside
    document.addEventListener("click", function(e) {
        const container = document.getElementById("teacher-test-dropdown-container");
        if (container && !container.contains(e.target)) {
            const menu = document.getElementById("teacher-test-dropdown-menu");
            const arrow = document.getElementById("teacher-dropdown-arrow");
            if (menu && menu.style.display === "block") {
                menu.style.display = "none";
                if (arrow) arrow.style.transform = "rotate(0deg)";
            }
        }
    });

    // Intercept clicks on start buttons if room is closed
    document.addEventListener("click", function(e) {
        const btn = e.target.closest && e.target.closest("#btn-start-test, #btn-start-exam, .btn-practice-cbt, .btn-start");
        if (!btn) return;
        if (typeof window.VstepExamRoom !== "undefined" && !window.VstepExamRoom.canStudentStartExam()) {
            e.preventDefault();
            e.stopImmediatePropagation();
            alert("⛔ PHÒNG THI HIỆN ĐANG ĐÓNG!\n\nVui lòng chờ Giáo viên (Cô Nguyệt) mở phòng để vào làm bài.");
        }
    }, true);

    // Global helper for password toggle in login modal
    window.toggleVstepLoginPassword = function() {
        const passInput = document.getElementById("vstep-input-pass") || document.getElementById("vstep-auth-password");
        const icon = document.getElementById("vstep-toggle-pwd-icon");
        if (!passInput) return;
        const isPassword = passInput.type === "password";
        passInput.type = isPassword ? "text" : "password";
        if (icon) {
            if (isPassword) {
                icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
            } else {
                icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
            }
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initFirebase);
    } else {
        initFirebase();
    }
})();
