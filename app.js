/* ==========================================================================
   VSTEP 4-SKILLS INTERACTIVE PORTAL - CORE SCRIPT
   Logic: Webcam capture, Audio Recording, Dynamic Timers, Visualizers
   ========================================================================== */

// 1. IndexedDB Manager (VstepMockDB)
const VstepDB = {
    dbName: "VstepMock4SkillsDB",
    dbVersion: 1,
    db: null,

    init() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve(this.db);
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains("answers")) {
                    db.createObjectStore("answers", { keyPath: "testId" });
                }
                if (!db.objectStoreNames.contains("recordings")) {
                    db.createObjectStore("recordings", { keyPath: "id" }); // id = testId_partId
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };
        });
    },

    async saveAnswers(testId, answersData) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction("answers", "readwrite");
            const store = transaction.objectStore("answers");
            const data = {
                testId: testId,
                answers: answersData,
                timestamp: Date.now()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAnswers(testId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction("answers", "readonly");
            const store = transaction.objectStore("answers");
            const request = store.get(testId);
            request.onsuccess = (e) => resolve(e.target.result ? e.target.result.answers : null);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async saveAudioRecording(testId, partId, blob) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction("recordings", "readwrite");
            const store = transaction.objectStore("recordings");
            const id = `${testId}_${partId}`;
            const data = {
                id: id,
                testId: testId,
                partId: partId,
                audioBlob: blob,
                timestamp: Date.now()
            };
            const request = store.put(data);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAudioRecording(testId, partId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction("recordings", "readonly");
            const store = transaction.objectStore("recordings");
            const id = `${testId}_${partId}`;
            const request = store.get(id);
            request.onsuccess = (e) => resolve(e.target.result ? e.target.result.audioBlob : null);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clearAll(testId) {
        const db = await this.init();
        const tx = db.transaction(["answers", "recordings"], "readwrite");
        tx.objectStore("answers").delete(testId);
        // Clear matching recordings
        const recStore = tx.objectStore("recordings");
        for (let part = 1; part <= 3; part++) {
            recStore.delete(`${testId}_${part}`);
        }
        return new Promise((resolve) => {
            tx.oncomplete = () => resolve(true);
        });
    }
};

// 2. Application State & Passwords
const TEST_PASSWORDS = {
    "VSTEP01": "ptmn2896",
    "VSTEP02": "ptmn2412",
    "VSTEP03": "ptmn2805"
};

const state = {
    testId: "VSTEPTEST01", // Key for data database (string code matching list)
    testData: null,
    candidatePhoto: null,
    candidateName: "Nguyệt Phạm",
    candidateClass: "12A1", // Candidate Class
    candidateAccount: "VSTEP01", // Candidate Account mapped to selected Test
    candidateCode: "VSTEPTEST01", // Displays selected Test Code
    
    // Exam status
    activeSkill: "listening", // 'listening', 'reading', 'writing', 'speaking'
    activePart: 1,
    
    // Timer statuses
    globalInterval: null,
    skillTimers: {
        listening: 47 * 60,
        reading: 60 * 60,
        writing: 60 * 60,
        speaking: 12 * 60
    },
    skillTimeRemaining: {
        listening: 0,
        reading: 0,
        writing: 0,
        speaking: 0
    },

    // Candidates Answers
    answers: {
        listening: {}, // { questionId: chosenAnswer }
        reading: {},    // { questionId: chosenAnswer }
        writing: {},    // { partId: writtenText }
    },
    
    // Speaking Test status
    speakingStage: "prep", // 'prep', 'speak'
    speakingTimerInterval: null,
    speakingTimeRemaining: 0,
    speakingMediaRecorder: null,
    speakingAudioChunks: [],
    speakingStream: null,
    
    // Audio contexts for notification & visualization
    audioContext: null,
    analyser: null,
    visualizerInterval: null,
    
    // Device check variables
    webcamStream: null,
    deviceCheckRecorder: null,
    deviceCheckChunks: [],
    deviceCheckBlob: null,
    deviceAudioCtx: null,
    deviceAnalyser: null,
    deviceVisualizerInterval: null,
    
    // Listening compliance audio players
    listeningAudioElement: null,
    activeListeningAudios: {}, // { audioId: Audio }
    listeningAudioPlayed: {}, // { audioId/partId: boolean }
    listeningConversationIndex: 0,
    
    // Highlighter status
    highlightModeActive: false
};

// 3. UI Dom Elements Cache
const DOM = {
    // Screens
    lockScreen: document.getElementById("lock-screen"),
    prepScreen: document.getElementById("prep-screen"),
    examScreen: document.getElementById("exam-screen"),
    resultScreen: document.getElementById("result-screen"),
    
    // Lock Screen Elements
    lockStudentName: document.getElementById("lock-student-name"),
    lockStudentClass: document.getElementById("lock-student-class"),
    lockTestId: document.getElementById("lock-test-id"),
    lockPassword: document.getElementById("lock-password"),
    btnToggleLockPwd: document.getElementById("btn-toggle-lock-pwd"),
    lockErrorMsg: document.getElementById("lock-error-msg"),
    lockErrorText: document.getElementById("lock-error-text"),
    btnUnlockExam: document.getElementById("btn-unlock-exam"),
    
    // Screen 1 Elements (Prep)
    candidateAccVal: document.getElementById("candidate-acc-val"),
    webcamPreview: document.getElementById("webcam-preview"),
    snapshotCanvas: document.getElementById("snapshot-canvas"),
    candidateAvatar: document.getElementById("candidate-avatar"),
    btnTakePhoto: document.getElementById("btn-take-photo"),
    cameraOverlay: document.getElementById("camera-overlay"),
    
    btnSamplePlay: document.getElementById("btn-sample-play"),
    sampleProgressBar: document.getElementById("sample-progress-bar"),
    sampleTime: document.getElementById("sample-time"),
    sampleAudio: document.getElementById("sample-audio-element"),
    
    waveformCanvas: document.getElementById("waveform-canvas"),
    btnRecordTest: document.getElementById("btn-record-test"),
    btnPlayTest: document.getElementById("btn-play-test"),
    recordingStatusText: document.getElementById("recording-status-text"),
    micStatusDot: document.querySelector(".recording-dot"),
    waveformContainer: document.querySelector(".waveform-container"),
    
    btnStartExam: document.getElementById("btn-start-exam"),
    btnThemeToggle: document.getElementById("btn-theme-toggle"),
    
    // Screen 2 Elements (Exam)
    examAvatar: document.getElementById("exam-avatar"),
    examCandidateName: document.getElementById("exam-candidate-name"),
    examCandidateClass: document.getElementById("exam-candidate-class"),
    examTimerVal: document.getElementById("exam-timer-val"),
    timerCapsule: document.getElementById("timer-capsule"),
    answeredRatioLbl: document.getElementById("answered-ratio-lbl"),
    btnSubmitExam: document.getElementById("btn-submit-exam"),
    
    // Exam Skill Containers
    listeningArea: document.getElementById("listening-area"),
    readingArea: document.getElementById("reading-area"),
    writingArea: document.getElementById("writing-area"),
    speakingArea: document.getElementById("speaking-area"),
    
    // Skill Specific Contents
    listeningQuestions: document.getElementById("listening-questions-container"),
    listeningPartTitle: document.getElementById("listening-part-title"),
    listeningPartDesc: document.getElementById("listening-part-desc"),
    listeningAudioFilename: document.getElementById("listening-audio-filename"),
    btnListeningPlay: document.getElementById("btn-listening-play"),
    listeningProgressBar: document.getElementById("listening-progress-bar"),
    listeningPlayerTime: document.getElementById("listening-player-time"),
    
    readingPassageContent: document.getElementById("reading-passage-content"),
    readingQuestions: document.getElementById("reading-questions-container"),
    btnHighlightText: document.getElementById("btn-highlight-text"),
    
    writingPartTitle: document.getElementById("writing-part-title"),
    writingPartInstructions: document.getElementById("writing-part-instructions"),
    writingPromptContent: document.getElementById("writing-prompt-content"),
    writingTextarea: document.getElementById("writing-textarea"),
    writingWordCount: document.getElementById("writing-word-count"),
    
    speakingPromptContent: document.getElementById("speaking-prompt-content"),
    speakingStageLabel: document.getElementById("speaking-stage-label"),
    speakingRingTimerVal: document.getElementById("speaking-ring-timer-val"),
    speakingTimerRingProgress: document.getElementById("speaking-timer-ring-progress"),
    speakingWaveformCanvas: document.getElementById("speaking-waveform-canvas"),
    speakingRecordIndicator: document.getElementById("speaking-record-indicator"),
    speakingStatusText: document.getElementById("speaking-status-text"),
    btnSpeakingSkipPrep: document.getElementById("btn-speaking-skip-prep"),
    
    // Bottom navigation
    examFooter: document.getElementById("exam-footer"),
    btnToggleMenu: document.getElementById("btn-toggle-menu"),
    btnSaveProgress: document.getElementById("btn-save-progress"),
    btnNextPart: document.getElementById("btn-next-part"),
    
    // Screen 3 Elements (Results)
    resultAvatar: document.getElementById("result-avatar"),
    resultCandidateClass: document.getElementById("result-candidate-class"),
    scoreListeningVal: document.getElementById("score-listening-val"),
    scoreReadingVal: document.getElementById("score-reading-val"),
    btnRestartExam: document.getElementById("btn-restart-exam"),
    resultDetailsPanel: document.getElementById("result-details-panel"),
    detailsPanelTitle: document.getElementById("details-panel-title"),
    detailsPanelBody: document.getElementById("details-panel-body-content"),
    btnCloseDetails: document.getElementById("btn-close-details")
};

// ==========================================================================
// 4. Initialization & Setup Webcams/Mics
// ==========================================================================
window.addEventListener("DOMContentLoaded", async () => {
    // Check if there is an unlocked session cached in sessionStorage
    const activeTest = sessionStorage.getItem("unlocked_active_test");
    if (activeTest && sessionStorage.getItem("unlocked_test_" + activeTest) === "true") {
        // Unlock verified
        state.testId = activeTest;
        state.candidateCode = activeTest;
        state.candidateName = sessionStorage.getItem("unlocked_student_name") || "Nguyệt Phạm";
        state.candidateClass = sessionStorage.getItem("unlocked_student_class") || "12A1";
        state.candidateAccount = sessionStorage.getItem("unlocked_candidate_account") || "VSTEP01";
        
        DOM.lockScreen.classList.remove("active");
        DOM.prepScreen.classList.add("active");
        
        // Load data
        await initUnlockedExam();
    } else {
        // Show lock gate
        DOM.lockScreen.classList.add("active");
        DOM.prepScreen.classList.remove("active");
    }
    
    // Attach UI Listeners (such as verification, switching, clicks)
    attachEventListeners();
    attachLockGateListeners();
});

async function initUnlockedExam() {
    // Load test data
    state.testData = VSTEP_TESTS_DATA[state.testId];
    
    // Load cached answers if any
    const cachedAnswers = await VstepDB.getAnswers(state.testId);
    if (cachedAnswers) {
        state.answers = cachedAnswers;
    } else {
        state.answers = {
            listening: {},
            reading: {},
            writing: {}
        };
    }
    
    // Set profile names in UI
    document.getElementById("candidate-name-val").textContent = state.candidateName;
    document.getElementById("candidate-acc-val").textContent = state.candidateAccount;
    document.getElementById("candidate-class-val").textContent = state.candidateClass;
    document.getElementById("candidate-code-val").textContent = state.testId;
    DOM.examCandidateName.textContent = state.candidateName;
    if (DOM.examCandidateClass) DOM.examCandidateClass.textContent = "Lớp: " + state.candidateClass;
    document.getElementById("result-candidate-name").textContent = state.candidateName;
    document.getElementById("result-candidate-class").textContent = state.candidateClass;
    document.getElementById("result-exam-code").textContent = state.testId;
    
    // Reset timer Warning values
    state.listeningAudioPlayed = {};
    
    // Startup webcam
    initWebcam();
}

// Webcam start
async function initWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        state.webcamStream = stream;
        DOM.webcamPreview.srcObject = stream;
        DOM.webcamPreview.style.display = "block";
        DOM.candidateAvatar.style.display = "none";
        DOM.cameraOverlay.style.display = "flex";
    } catch (e) {
        console.warn("Camera access denied or unavailable:", e);
        DOM.cameraOverlay.innerHTML = "<i class='fa-solid fa-video-slash'></i> <span>Không nhận diện được camera</span>";
        DOM.cameraOverlay.style.display = "flex";
    }
}

function stopWebcam() {
    if (state.webcamStream) {
        state.webcamStream.getTracks().forEach(track => track.stop());
        state.webcamStream = null;
    }
}

// Chụp ảnh thẻ
DOM.btnTakePhoto.addEventListener("click", () => {
    if (state.webcamStream) {
        const video = DOM.webcamPreview;
        const canvas = DOM.snapshotCanvas;
        const context = canvas.getContext("2d");
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const dataUrl = canvas.toDataURL("image/png");
        state.candidatePhoto = dataUrl;
        
        // Show snapshot and replace video
        DOM.candidateAvatar.src = dataUrl;
        DOM.candidateAvatar.style.display = "block";
        DOM.webcamPreview.style.display = "none";
        
        // Update images in other screens
        DOM.examAvatar.src = dataUrl;
        DOM.resultAvatar.src = dataUrl;
        
        showToast("Chụp hình thành công!", "success");
        stopWebcam();
    } else {
        // Fallback placeholder
        showToast("Thiết bị camera không hoạt động.", "error");
    }
});

// Theme switcher
DOM.btnThemeToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    const icon = DOM.btnThemeToggle.querySelector("i");
    if (document.body.classList.contains("dark-theme")) {
        icon.className = "fa-solid fa-moon";
    } else {
        icon.className = "fa-solid fa-sun";
    }
});

// ==========================================================================
// 5. Sound & Microphone Test (Prep Screen)
// ==========================================================================

// Sample Audio Player
DOM.btnSamplePlay.addEventListener("click", () => {
    const audio = DOM.sampleAudio;
    if (audio.paused) {
        audio.play();
        DOM.btnSamplePlay.innerHTML = "<i class='fa-solid fa-pause'></i>";
    } else {
        audio.pause();
        DOM.btnSamplePlay.innerHTML = "<i class='fa-solid fa-play'></i>";
    }
});

DOM.sampleAudio.addEventListener("timeupdate", () => {
    const audio = DOM.sampleAudio;
    const limit = 20; // Cut at 20 seconds
    
    if (audio.currentTime >= limit) {
        audio.pause();
        audio.currentTime = 0;
        DOM.btnSamplePlay.innerHTML = "<i class='fa-solid fa-play'></i>";
        DOM.sampleProgressBar.style.width = "0%";
        DOM.sampleTime.textContent = "0:00 / 0:20";
        return;
    }
    
    const progress = (audio.currentTime / limit) * 100;
    DOM.sampleProgressBar.style.width = `${progress}%`;
    DOM.sampleTime.textContent = `${formatTime(audio.currentTime)} / 0:20`;
});

DOM.sampleAudio.addEventListener("ended", () => {
    DOM.btnSamplePlay.innerHTML = "<i class='fa-solid fa-play'></i>";
    DOM.sampleProgressBar.style.width = "0%";
    DOM.sampleTime.textContent = "0:00 / 0:20";
});

// Mic check recording
DOM.btnRecordTest.addEventListener("click", async () => {
    if (state.deviceCheckRecorder && state.deviceCheckRecorder.state === "recording") {
        return; // Already recording
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.deviceCheckChunks = [];
        
        // Init visualizer
        setupDeviceVisualizer(stream);
        
        const mediaRecorder = new MediaRecorder(stream);
        state.deviceCheckRecorder = mediaRecorder;
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                state.deviceCheckChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            state.deviceCheckBlob = new Blob(state.deviceCheckChunks, { type: "audio/ogg; codecs=opus" });
            DOM.btnPlayTest.disabled = false;
            DOM.recordingStatusText.textContent = "Kiểm tra hoàn thành";
            DOM.waveformContainer.classList.remove("active");
            
            // Stop mic track
            stream.getTracks().forEach(track => track.stop());
            stopDeviceVisualizer();
        };
        
        mediaRecorder.start();
        DOM.recordingStatusText.textContent = "Đang thu âm (5s)...";
        DOM.waveformContainer.classList.add("active");
        DOM.btnPlayTest.disabled = true;
        
        // Auto stop after 5s
        setTimeout(() => {
            if (mediaRecorder.state === "recording") {
                mediaRecorder.stop();
            }
        }, 5000);
        
    } catch (e) {
        console.error("Microphone access failed:", e);
        showToast("Không tìm thấy Microphone hoặc bị chặn quyền truy cập.", "error");
        DOM.recordingStatusText.textContent = "Mic Lỗi!";
    }
});

DOM.btnPlayTest.addEventListener("click", () => {
    if (state.deviceCheckBlob) {
        const audioUrl = URL.createObjectURL(state.deviceCheckBlob);
        const playAudio = new Audio(audioUrl);
        playAudio.play();
        showToast("Đang phát lại bản thu âm...", "info");
    }
});

function setupDeviceVisualizer(stream) {
    state.deviceAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.deviceAudioCtx.createMediaStreamSource(stream);
    state.deviceAnalyser = state.deviceAudioCtx.createAnalyser();
    state.deviceAnalyser.fftSize = 256;
    source.connect(state.deviceAnalyser);
    
    const canvas = DOM.waveformCanvas;
    const ctx = canvas.getContext("2d");
    const bufferLength = state.deviceAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
        if (!state.deviceAnalyser) return;
        requestAnimationFrame(draw);
        
        state.deviceAnalyser.getByteFrequencyData(dataArray);
        
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            
            // HSL violet gradient
            ctx.fillStyle = `hsl(${260 + (i * 2)}, 80%, 50%)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
    
    draw();
}

function stopDeviceVisualizer() {
    state.deviceAnalyser = null;
    if (state.deviceAudioCtx) {
        state.deviceAudioCtx.close();
        state.deviceAudioCtx = null;
    }
}

// ==========================================================================
// 6. Exam Navigation & Screen Transition
// ==========================================================================

// Click NHẬN ĐỀ
DOM.btnStartExam.addEventListener("click", () => {
    // 1. Release prep devices
    stopWebcam();
    stopDeviceVisualizer();
    DOM.sampleAudio.pause();
    
    // 2. Set default candidate avatar in Exam Header
    if (!state.candidatePhoto) {
        DOM.examAvatar.src = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%237c3aed'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
        DOM.resultAvatar.src = DOM.examAvatar.src;
    }
    
    // 3. Screen transition
    DOM.prepScreen.classList.remove("active");
    DOM.examScreen.classList.add("active");
    
    // 4. Initialize exam timers
    initExamTimers();
    
    // 5. Render first skill/part
    loadSkillPart(state.activeSkill, state.activePart);
    
    showToast("Bài thi bắt đầu! Chúc bạn thi tốt.", "info");
});

function initExamTimers() {
    // Set timing durations from state
    for (let skill in state.skillTimers) {
        state.skillTimeRemaining[skill] = state.skillTimers[skill];
    }
    
    // Main global countdown interval
    state.globalInterval = setInterval(() => {
        const skill = state.activeSkill;
        
        // Speaking has automated sub-timers, we only decrement overall speaking time for progress
        if (skill !== "speaking") {
            state.skillTimeRemaining[skill]--;
            
            // Check if active skill has run out of time
            if (state.skillTimeRemaining[skill] <= 0) {
                state.skillTimeRemaining[skill] = 0;
                handleSkillTimeout(skill);
            }
        } else {
            // Overall speaking timer decrement
            if (state.skillTimeRemaining[skill] > 0) {
                state.skillTimeRemaining[skill]--;
            }
        }
        
        // Update timer UI capsule
        updateTimerUI();
    }, 1000);
}

function handleSkillTimeout(skill) {
    showToast(`Hết thời gian làm bài kỹ năng ${skill.toUpperCase()}! Hệ thống tự động chuyển kỹ năng.`, "error");
    
    // Auto save answers
    VstepDB.saveAnswers(state.testId, state.answers);
    
    if (skill === "listening") {
        state.activeSkill = "reading";
        state.activePart = 1;
    } else if (skill === "reading") {
        state.activeSkill = "writing";
        state.activePart = 1;
    } else if (skill === "writing") {
        state.activeSkill = "speaking";
        state.activePart = 1;
    } else if (skill === "speaking") {
        submitExam();
        return;
    }
    
    loadSkillPart(state.activeSkill, state.activePart);
}

function updateTimerUI() {
    const active = state.activeSkill;
    const seconds = state.skillTimeRemaining[active];
    
    // Format mm:ss or hh:mm:ss
    DOM.examTimerVal.textContent = formatTimerDigital(seconds);
    
    // Red warn styling below 5 minutes (300 seconds)
    if (seconds < 300) {
        DOM.timerCapsule.classList.add("time-warning");
    } else {
        DOM.timerCapsule.classList.remove("time-warning");
    }
}

function formatTimerDigital(totalSecs) {
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    
    const mStr = m.toString().padStart(2, "0");
    const sStr = s.toString().padStart(2, "0");
    
    if (h > 0) {
        return `${h}:${mStr}:${sStr}`;
    }
    return `${mStr}:${sStr}`;
}

// Load specific skill and part contents
function loadSkillPart(skill, part) {
    // Ensure Next Part button is visible when entering skills
    if (DOM.btnNextPart) {
        DOM.btnNextPart.style.display = "";
    }
    // 1. Reset active visual indicators on skill areas
    document.querySelectorAll(".skill-area").forEach(area => area.classList.remove("active"));
    
    state.activeSkill = skill;
    state.activePart = part;
    
    // Stop any listening audio playing
    stopListeningAudio();
    
    // Stop speaking timer if switching away
    stopSpeakingSubTimer();
    
    // Toggle body scroll locking for split layout screens (reading, writing)
    if (skill === "reading" || skill === "writing") {
        document.body.classList.add("lock-scroll");
    } else {
        document.body.classList.remove("lock-scroll");
    }
    
    // Update active UI container
    if (skill === "listening") {
        DOM.listeningArea.classList.add("active");
        renderListeningPart(part);
    } else if (skill === "reading") {
        DOM.readingArea.classList.add("active");
        renderReadingPart(part);
    } else if (skill === "writing") {
        DOM.writingArea.classList.add("active");
        renderWritingPart(part);
    } else if (skill === "speaking") {
        DOM.speakingArea.classList.add("active");
        renderSpeakingPart(part);
    }
    
    // Update bottom nav active pills styling
    updateBottomNavPills();
    
    // Update overall progress ratio label
    updateProgressRatioLabel();
    
    // Reset page scroll position
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// Progress label generator
function updateProgressRatioLabel() {
    if (!DOM.answeredRatioLbl) return;
    const skill = state.activeSkill || "listening";
    let answered = 0;
    let total = 0;
    
    if (skill === "listening") {
        total = 35;
        answered = Object.keys(state.answers.listening || {}).length;
        DOM.answeredRatioLbl.textContent = `Đã trả lời: ${answered}/${total}`;
    } else if (skill === "reading") {
        total = 40;
        answered = Object.keys(state.answers.reading || {}).length;
        DOM.answeredRatioLbl.textContent = `Đã trả lời: ${answered}/${total}`;
    } else if (skill === "writing") {
        total = 2;
        if (state.answers.writing && state.answers.writing["1"]) answered++;
        if (state.answers.writing && state.answers.writing["2"]) answered++;
        DOM.answeredRatioLbl.textContent = `Đã trả lời: ${answered}/${total}`;
    } else if (skill === "speaking") {
        total = 3;
        let countSpeak = 0;
        Promise.all([
            VstepDB.getAudioRecording(state.testId, 1),
            VstepDB.getAudioRecording(state.testId, 2),
            VstepDB.getAudioRecording(state.testId, 3)
        ]).then(blobs => {
            blobs.forEach(b => { if (b) countSpeak++; });
            DOM.answeredRatioLbl.textContent = `Đã trả lời: ${countSpeak}/${total}`;
        }).catch(() => {
            DOM.answeredRatioLbl.textContent = `Đã trả lời: 0/${total}`;
        });
    }
}

// ==========================================================================// 7. Listening Skill Controller
// ==========================================================================
function renderListeningPart(partId) {
    const partData = state.testData.listening.find(p => p.partId === partId);
    if (!partData) return;
    
    DOM.listeningPartTitle.textContent = `${state.testData.title.toUpperCase()} - ${partData.title.toUpperCase()}`;
    DOM.listeningPartDesc.textContent = partData.instructions;
    
    const topPlayerCard = document.querySelector(".listening-player-card");
    const hasSplitAudios = partData.audioFiles && partData.audioFiles.length > 0;
    
    DOM.listeningQuestions.innerHTML = "";
    
    if (hasSplitAudios) {
        topPlayerCard.style.display = "none";
        
        // Render grouped by conversation
        partData.audioFiles.forEach((audioInfo, index) => {
            const nextAudioInfo = partData.audioFiles[index + 1];
            const endQ = nextAudioInfo ? nextAudioInfo.qStart : 999;
            
            const groupQuestions = partData.questions.filter(q => q.id >= audioInfo.qStart && q.id < endQ);
            
            const groupCard = document.createElement("div");
            groupCard.className = "conversation-group-card";
            groupCard.style.cssText = "background: white; border-radius: 16px; padding: 24px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid var(--border-color);";
            
            const audioId = audioInfo.id;
            const isPlayed = state.listeningAudioPlayed[audioId];
            
            const inlinePlayer = document.createElement("div");
            inlinePlayer.className = "listening-player-card inline-player-card";
            inlinePlayer.style.cssText = "margin-bottom: 20px; box-shadow: none; border: 1px solid var(--color-blue); background: rgba(59, 130, 246, 0.05);";
            inlinePlayer.innerHTML = `
                <div style="display: flex; width: 100%; align-items: center; gap: 16px;">
                    <button class="listening-play-btn btn-listening-play-multi ripple" data-audio-id="${audioId}" data-url="${audioInfo.url}" ${isPlayed ? "disabled" : ""}>
                        <i class="fa-solid ${isPlayed ? "fa-lock" : "fa-play"}"></i>
                    </button>
                    <div class="listening-player-info">
                        <div class="listening-player-title" style="font-weight: 700; color: var(--color-blue);">${audioInfo.title}</div>
                        <div class="listening-player-timeline">
                            <div class="listening-multi-progress-bar" data-audio-id="${audioId}" style="width: ${isPlayed ? "100%" : "0%"}"></div>
                        </div>
                    </div>
                    <span class="listening-player-time listening-multi-player-time" data-audio-id="${audioId}">${isPlayed ? "Đã khóa" : "0:00"}</span>
                </div>
                <div class="listening-compliance-warning" style="margin-top: 10px; width: 100%;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>* Nhấn Play để bắt đầu bài nghe. Thí sinh chỉ được nghe một lần.</span>
                </div>
            `;
            groupCard.appendChild(inlinePlayer);
            
            groupQuestions.forEach(q => {
                const qBox = createQuestionDOM(q);
                groupCard.appendChild(qBox);
            });
            
            DOM.listeningQuestions.appendChild(groupCard);
        });
        
        document.querySelectorAll(".btn-listening-play-multi").forEach(btn => {
            btn.addEventListener("click", () => {
                const audioId = btn.dataset.audioId;
                const url = btn.dataset.url;
                if (state.listeningAudioPlayed[audioId]) {
                    showToast("Bạn đã nghe bài này rồi. Thí sinh chỉ được nghe 1 lần.", "warning");
                    return;
                }
                
                for (let k in state.activeListeningAudios) {
                    if (state.activeListeningAudios[k]) state.activeListeningAudios[k].pause();
                }
                
                if (!state.activeListeningAudios[audioId]) {
                    const aud = new Audio(encodeURI(url));
                    state.activeListeningAudios[audioId] = aud;
                    
                    const progressBar = document.querySelector(`.listening-multi-progress-bar[data-audio-id="${audioId}"]`);
                    const timeSpan = document.querySelector(`.listening-multi-player-time[data-audio-id="${audioId}"]`);
                    
                    aud.addEventListener("timeupdate", () => {
                        if (aud.duration) {
                            const pct = (aud.currentTime / aud.duration) * 100;
                            if (progressBar) progressBar.style.width = `${pct}%`;
                            if (timeSpan) timeSpan.textContent = formatAudioTime(aud.currentTime) + " / " + formatAudioTime(aud.duration);
                        }
                    });
                    
                    aud.addEventListener("ended", () => {
                        state.listeningAudioPlayed[audioId] = true;
                        btn.disabled = true;
                        btn.innerHTML = "<i class='fa-solid fa-lock'></i>";
                        if (timeSpan) timeSpan.textContent = "Đã khóa";
                        showToast("Đã nghe xong đoạn hội thoại.", "info");
                    });
                }
                
                state.activeListeningAudios[audioId].play().then(() => {
                    btn.innerHTML = "<i class='fa-solid fa-volume-high'></i>";
                    showToast("Bắt đầu phát Audio...", "info");
                }).catch(err => {
                    showToast("Không thể phát audio: " + err.message, "error");
                });
            });
        });
        
    } else {
        topPlayerCard.style.display = "";
        const singlePlayer = document.getElementById("listening-single-player");
        const multiPlayer = document.getElementById("listening-multi-player");
        if (singlePlayer) singlePlayer.style.display = "flex";
        if (multiPlayer) multiPlayer.style.display = "none";
        
        DOM.listeningAudioFilename.textContent = partData.audioUrl.substring(partData.audioUrl.lastIndexOf('/') + 1);
        
        const playBtn = DOM.btnListeningPlay;
        playBtn.innerHTML = "<i class='fa-solid fa-play'></i>";
        DOM.listeningProgressBar.style.width = "0%";
        DOM.listeningPlayerTime.textContent = "0:00";
        
        if (state.listeningAudioPlayed[partId]) {
            playBtn.disabled = true;
            playBtn.innerHTML = "<i class='fa-solid fa-lock'></i>";
        } else {
            playBtn.disabled = false;
        }
        
        partData.questions.forEach(q => {
            const qBox = createQuestionDOM(q);
            DOM.listeningQuestions.appendChild(qBox);
        });
    }
}

function createQuestionDOM(q) {
    const qBox = document.createElement("div");
    qBox.className = "question-item-box";
    qBox.id = fLabel(`listening_q_${q.id}`);
    
    const qHeader = document.createElement("div");
    qHeader.className = "question-header-row";
    qHeader.innerHTML = `<strong>Question ${q.id}:</strong> ${q.question}`;
    qBox.appendChild(qHeader);
    
    const optionsList = document.createElement("div");
    optionsList.className = "question-options-list";
    
    q.options.forEach((optText, index) => {
        const letter = String.fromCharCode(65 + index);
        const optionItem = document.createElement("div");
        optionItem.className = "option-choice-item";
        
        const savedAns = state.answers.listening[q.id];
        if (savedAns === letter) {
            optionItem.classList.add("selected");
        }
        
        optionItem.innerHTML = `
            <input type="radio" name="listening_opt_${q.id}" class="option-radio" value="${letter}" ${savedAns === letter ? "checked" : ""}>
            <span><strong>${letter}.</strong> ${optText}</span>
        `;
        
        optionItem.addEventListener("click", () => {
            const radio = optionItem.querySelector("input[type='radio']");
            radio.checked = true;
            document.querySelectorAll(`input[name="listening_opt_${q.id}"]`).forEach(r => {
                r.closest(".option-choice-item").classList.remove("selected");
            });
            optionItem.classList.add("selected");
            state.answers.listening[q.id] = letter;
            updateBottomNavPills();
            updateProgressRatioLabel();
        });
        
        optionsList.appendChild(optionItem);
    });
    
    qBox.appendChild(optionsList);
    return qBox;
}

// 8. Reading Skill Controller
// ==========================================================================
function renderReadingPart(partId) {
    const partData = state.testData.reading.parts.find(p => p.partId === partId);
    if (!partData) return;
    
    // Render passage
    DOM.readingPassageContent.innerHTML = partData.passage;
    
    // Render questions
    DOM.readingQuestions.innerHTML = "";
    partData.questions.forEach(q => {
        const qBox = document.createElement("div");
        qBox.className = "question-item-box";
        qBox.id = fLabel(`reading_q_${q.id}`);
        
        // Question title
        const qHeader = document.createElement("div");
        qHeader.className = "question-header-row";
        qHeader.innerHTML = `<strong>Question ${q.id}:</strong> ${q.question}`;
        qBox.appendChild(qHeader);
        
        // Options container
        const optionsList = document.createElement("div");
        optionsList.className = "question-options-list";
        
        q.options.forEach((optText, index) => {
            const letter = String.fromCharCode(65 + index); // A, B, C, D
            const optionItem = document.createElement("div");
            optionItem.className = "option-choice-item";
            
            const savedAns = state.answers.reading[q.id];
            if (savedAns === letter) {
                optionItem.classList.add("selected");
            }
            
            optionItem.innerHTML = `
                <input type="radio" name="reading_opt_${q.id}" class="option-radio" value="${letter}" ${savedAns === letter ? "checked" : ""}>
                <span><strong>${letter}.</strong> ${optText}</span>
            `;
            
            optionItem.addEventListener("click", () => {
                optionItem.querySelector("input").checked = true;
                optionItem.parentNode.querySelectorAll(".option-choice-item").forEach(item => item.classList.remove("selected"));
                optionItem.classList.add("selected");
                
                // save answer
                state.answers.reading[q.id] = letter;
                updateBottomNavPills();
                updateProgressRatioLabel();
            });
            
            optionsList.appendChild(optionItem);
        });
        
        qBox.appendChild(optionsList);
        DOM.readingQuestions.appendChild(qBox);
    });
}

// Highlighter text support
DOM.btnHighlightText.addEventListener("click", () => {
    state.highlightModeActive = !state.highlightModeActive;
    DOM.btnHighlightText.classList.toggle("active");
    if (state.highlightModeActive) {
        showToast("Đã bật chế độ Highlighter. Hãy bôi đen chữ trong đoạn văn để đánh dấu.", "info");
        document.addEventListener("mouseup", handleTextHighlight);
    } else {
        document.removeEventListener("mouseup", handleTextHighlight);
    }
});

function handleTextHighlight() {
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;
    
    const range = selection.getRangeAt(0);
    const container = document.getElementById("reading-passage-content");
    
    // Check if selection is within passage container
    if (container.contains(range.commonAncestorContainer)) {
        const span = document.createElement("span");
        span.className = "vstep-highlight";
        try {
            range.surroundContents(span);
        } catch (e) {
            console.warn("Complex highlight ranges are not surroundable:", e);
        }
        selection.removeAllRanges();
    }
}

// ==========================================================================
// 9. Writing Skill Controller
// ==========================================================================
function renderWritingPart(partId) {
    const partData = state.testData.writing.parts.find(p => p.partId === partId);
    if (!partData) return;
    
    DOM.writingPartTitle.textContent = partData.title.toUpperCase();
    DOM.writingPartInstructions.textContent = partData.instructions;
    DOM.writingPromptContent.innerHTML = partData.prompt;
    
    // Bind current written answer
    const savedAns = state.answers.writing[partId.toString()] || "";
    DOM.writingTextarea.value = savedAns;
    
    // Word counter update
    updateWordCount(savedAns);
}

DOM.writingTextarea.addEventListener("input", (e) => {
    const val = e.target.value;
    state.answers.writing[state.activePart.toString()] = val;
    updateWordCount(val);
    updateBottomNavPills();
    updateProgressRatioLabel();
});

function updateWordCount(text) {
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    DOM.writingWordCount.textContent = words.length;
}

// ==========================================================================
// 10. Speaking Skill Controller
// ==========================================================================
const SPEAKING_TIMINGS = {
    1: { prep: 0, speak: 180 }, // Part 1
    2: { prep: 60, speak: 180 }, // Part 2
    3: { prep: 60, speak: 240 }  // Part 3
};

function renderSpeakingPart(partId) {
    const partData = state.testData.speaking.parts.find(p => p.partId === partId);
    if (!partData) return;
    
    DOM.speakingPromptContent.innerHTML = partData.prompt;
    
    // Completely hide the manual Next Part button to enforce automated transitions
    // DOM.btnNextPart.style.display = "none";
    
    // Initiate timing parameters
    const timings = SPEAKING_TIMINGS[partId];
    
    if (timings.prep > 0) {
        startSpeakingPrep(timings.prep, timings.speak);
    } else {
        // Skip prep stage
        startSpeakingRecord(timings.speak);
    }
}

function startSpeakingPrep(prepTime, speakTime) {
    state.speakingStage = "prep";
    state.speakingTimeRemaining = prepTime;
    
    DOM.speakingStageLabel.textContent = "CHUẨN BỊ";
    DOM.speakingStageLabel.style.color = "var(--color-amber)";
    DOM.btnSpeakingSkipPrep.style.display = "none";
    DOM.speakingRecordIndicator.style.display = "none";
    
    // Synthesized warning sound (oscillator beep)
    playSynthesizedTone(600, 0.2);
    
    // Start interval
    runSpeakingSubTimer(prepTime, () => {
        // Callback when prep completes -> start recording
        startSpeakingRecord(speakTime);
    });
}

DOM.btnSpeakingSkipPrep.addEventListener("click", () => {
    if (state.speakingStage === "prep") {
        stopSpeakingSubTimer();
        const timings = SPEAKING_TIMINGS[state.activePart];
        startSpeakingRecord(timings.speak);
    }
});

async function startSpeakingRecord(speakTime) {
    state.speakingStage = "speak";
    state.speakingTimeRemaining = speakTime;
    
    DOM.speakingStageLabel.textContent = "ĐANG THU ÂM";
    DOM.speakingStageLabel.style.color = "var(--color-red)";
    DOM.btnSpeakingSkipPrep.style.display = "none";
    DOM.speakingRecordIndicator.style.display = "block";
    DOM.speakingTimerRingProgress.style.stroke = "var(--color-red)";
    
    // Double synthesized beep to start speaking
    playSynthesizedTone(880, 0.15);
    setTimeout(() => playSynthesizedTone(880, 0.15), 200);
    
    // Initialize recording
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        state.speakingStream = stream;
        state.speakingAudioChunks = [];
        
        // Start visuals visualizer
        setupSpeakingVisualizer(stream);
        
        const mediaRecorder = new MediaRecorder(stream);
        state.speakingMediaRecorder = mediaRecorder;
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                state.speakingAudioChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(state.speakingAudioChunks, { type: "audio/ogg; codecs=opus" });
            
            // Save inside IndexedDB
            await VstepDB.saveAudioRecording(state.testId, state.activePart, audioBlob);
            
            // Stop tracks
            stream.getTracks().forEach(track => track.stop());
            stopSpeakingVisualizer();
            
            showToast(`Đã lưu bài thu âm Speaking Part ${state.activePart} thành công.`, "success");
            updateBottomNavPills();
            updateProgressRatioLabel();
        };
        
        mediaRecorder.start();
        DOM.speakingStatusText.textContent = "GHI ÂM ĐANG BẬT";
        
    } catch (e) {
        console.error("Speaking mic initialization failed:", e);
        showToast("Không tìm thấy Microphone hoặc lỗi quyền thu âm.", "error");
        DOM.speakingStatusText.textContent = "Lỗi thiết bị!";
    }
    
    // Start countdown timer
    runSpeakingSubTimer(speakTime, () => {
        // Callback when speaking finishes
        stopSpeakingRecording();
    });
}

function stopSpeakingRecording() {
    if (state.speakingMediaRecorder && state.speakingMediaRecorder.state === "recording") {
        state.speakingMediaRecorder.stop();
        state.speakingMediaRecorder = null;
    }
    
    // Double beep at completion
    playSynthesizedTone(440, 0.3);
    
    DOM.speakingRecordIndicator.style.display = "none";
    DOM.speakingStatusText.textContent = "GHI ÂM TẮT";
    
    // Auto advance to next Speaking part, or auto-submit
    setTimeout(() => {
        if (state.activePart < 3) {
            loadSkillPart("speaking", state.activePart + 1);
        } else {
            showToast("Đã hoàn thành phần thi Nói. Đang tự động nộp bài...", "success");
            setTimeout(() => {
                submitExam();
            }, 1000);
        }
    }, 1500);
}

function runSpeakingSubTimer(totalSecs, callback) {
    stopSpeakingSubTimer();
    
    let elapsed = 0;
    DOM.speakingRingTimerVal.textContent = formatTime(totalSecs);
    setTimerRingProgress(100);
    
    state.speakingTimerInterval = setInterval(() => {
        elapsed++;
        const remaining = totalSecs - elapsed;
        state.speakingTimeRemaining = remaining;
        
        DOM.speakingRingTimerVal.textContent = formatTime(remaining);
        
        // Progress percentage for circular ring SVG
        const pct = (remaining / totalSecs) * 100;
        setTimerRingProgress(pct);
        
        if (remaining <= 0) {
            clearInterval(state.speakingTimerInterval);
            state.speakingTimerInterval = null;
            callback();
        }
    }, 1000);
}

function stopSpeakingSubTimer() {
    if (state.speakingTimerInterval) {
        clearInterval(state.speakingTimerInterval);
        state.speakingTimerInterval = null;
    }
    // Stop mic recording if active
    if (state.speakingMediaRecorder && state.speakingMediaRecorder.state === "recording") {
        state.speakingMediaRecorder.stop();
        state.speakingMediaRecorder = null;
    }
}

function setTimerRingProgress(percent) {
    const circle = DOM.speakingTimerRingProgress;
    const radius = circle.r.baseVal.value;
    const circumference = 2 * Math.PI * radius; // ~534
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
}

function setupSpeakingVisualizer(stream) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = state.audioContext.createMediaStreamSource(stream);
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);
    
    const canvas = DOM.speakingWaveformCanvas;
    const ctx = canvas.getContext("2d");
    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
        if (!state.analyser) return;
        requestAnimationFrame(draw);
        
        state.analyser.getByteFrequencyData(dataArray);
        
        ctx.fillStyle = "#0f172a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2.2;
            
            // HSL red/pink gradient for record visualization
            ctx.fillStyle = `hsl(${340 + (i * 2)}, 90%, 55%)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
    
    draw();
}

function stopSpeakingVisualizer() {
    state.analyser = null;
    if (state.audioContext) {
        state.audioContext.close();
        state.audioContext = null;
    }
}

// Notification sound tones generators (oscillator synthesizers)
function playSynthesizedTone(freq, duration) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime + duration - 0.05);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + duration);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn("Tones fail:", e);
    }
}

// ==========================================================================
// 11. Bottom Navigation Actions & Save functions
// ==========================================================================
function attachEventListeners() {
    // Nav pills clicking
    document.querySelectorAll(".nav-pill").forEach(pill => {
        pill.addEventListener("click", () => {
            const skill = pill.dataset.skill;
            const part = parseInt(pill.dataset.part);
            
            // Limit navigation to the active skill only
            if (skill !== state.activeSkill) {
                const skillOrder = ["listening", "reading", "writing", "speaking"];
                const activeIndex = skillOrder.indexOf(state.activeSkill);
                const targetIndex = skillOrder.indexOf(skill);
                
                if (targetIndex < activeIndex) {
                    showToast("Không thể quay lại kỹ năng đã hoàn thành.", "error");
                } else {
                    showToast("Vui lòng làm bài theo trình tự. Bạn không thể nhảy sang kỹ năng tiếp theo.", "error");
                }
                return; // Block navigation
            }
            
            loadSkillPart(skill, part);
        });
    });
    
    // Toggle navigation bar collapse
    DOM.btnToggleMenu.addEventListener("click", () => {
        DOM.examFooter.classList.toggle("collapsed");
        
        // Setup floating display button if collapsed
        let floatBtn = document.getElementById("float-menu-btn");
        if (!floatBtn) {
            floatBtn = document.createElement("button");
            floatBtn.id = "float-menu-btn";
            floatBtn.className = "show-menu-floating-btn";
            floatBtn.innerHTML = "<i class='fa-solid fa-eye'></i>";
            document.body.appendChild(floatBtn);
            
            floatBtn.addEventListener("click", () => {
                DOM.examFooter.classList.remove("collapsed");
                floatBtn.style.display = "none";
            });
        }
        
        if (DOM.examFooter.classList.contains("collapsed")) {
            floatBtn.style.display = "flex";
        } else {
            floatBtn.style.display = "none";
        }
    });
    
    // Next button
    DOM.btnNextPart.addEventListener("click", () => {
        const skill = state.activeSkill;
        const part = state.activePart;
        
        if (skill === "listening") {
            if (part < 3) {
                loadSkillPart(skill, part + 1);
            } else {
                loadSkillPart("reading", 1);
            }
        } else if (skill === "reading") {
            if (part < 4) {
                loadSkillPart(skill, part + 1);
            } else {
                loadSkillPart("writing", 1);
            }
        } else if (skill === "writing") {
            if (part < 2) {
                loadSkillPart(skill, part + 1);
            } else {
                loadSkillPart("speaking", 1);
            }
        } else if (skill === "speaking") {
            if (part < 3) {
                loadSkillPart(skill, part + 1);
            } else {
                showToast("Bạn đang ở phần cuối cùng của bài thi. Hãy nhấn 'Nộp bài' để hoàn tất.", "info");
            }
        }
    });
    
    // Save button
    DOM.btnSaveProgress.addEventListener("click", async () => {
        await VstepDB.saveAnswers(state.testId, state.answers);
        showToast("Đã lưu bài làm vào bộ nhớ cục bộ thành công!", "success");
    });
    
    // Submit Exam click
    DOM.btnSubmitExam.addEventListener("click", () => {
        const confirmSubmit = confirm("Bạn có chắc chắn muốn nộp bài thi? Các câu trả lời của bạn sẽ được lưu lại và chấm điểm.");
        if (confirmSubmit) {
            submitExam();
        }
    });
    
    // Close detail result panel
    DOM.btnCloseDetails.addEventListener("click", () => {
        DOM.resultDetailsPanel.style.display = "none";
    });
    
    // Restart test
    DOM.btnRestartExam.addEventListener("click", async () => {
        const doubleCheck = confirm("Bạn muốn xóa kết quả và thực hiện lại bài thi từ đầu?");
        if (doubleCheck) {
            await VstepDB.clearAll(state.testId);
            
            // Reset state answers
            state.answers = {
                listening: {},
                reading: {},
                writing: {}
            };
            state.activeSkill = "listening";
            state.activePart = 1;
            state.listeningAudioPlayed = {};
            
            // Reload page or transition to prep
            DOM.resultScreen.classList.remove("active");
            DOM.prepScreen.classList.add("active");
            initWebcam();
        }
    });

    // Logout/Switch account
    const btnLogout = document.getElementById("btn-logout-exam");
    if (btnLogout) {
        btnLogout.addEventListener("click", (e) => {
            e.preventDefault();
            sessionStorage.clear();
            location.reload();
        });
    }
}

function updateBottomNavPills() {
    document.querySelectorAll(".nav-pill").forEach(pill => {
        const skill = pill.dataset.skill;
        const part = parseInt(pill.dataset.part);
        
        // Clear active and locked states
        pill.classList.remove("active", "answered", "visited", "locked");
        
        // Lock pills of other skills
        if (skill !== state.activeSkill) {
            pill.classList.add("locked");
        }
        
        if (state.activeSkill === skill && state.activePart === part) {
            pill.classList.add("active");
            return;
        }
        
        // Answered check
        let isAnswered = false;
        
        if (skill === "listening") {
            // Part 1: Q1-8, Part 2: Q9-20, Part 3: Q21-35
            const qRanges = { 1: [1, 8], 2: [9, 20], 3: [21, 35] };
            const range = qRanges[part];
            let ansCount = 0;
            for (let id = range[0]; id <= range[1]; id++) {
                if (state.answers.listening[id]) ansCount++;
            }
            if (ansCount > 0) {
                isAnswered = true;
                pill.classList.add("answered");
            }
        } else if (skill === "reading") {
            // Part 1: Q1-10, Part 2: Q11-20, Part 3: Q21-30, Part 4: Q31-40
            const qRanges = { 1: [1, 10], 2: [11, 20], 3: [21, 30], 4: [31, 40] };
            const range = qRanges[part];
            let ansCount = 0;
            for (let id = range[0]; id <= range[1]; id++) {
                if (state.answers.reading[id]) ansCount++;
            }
            if (ansCount > 0) {
                isAnswered = true;
                pill.classList.add("answered");
            }
        } else if (skill === "writing") {
            if (state.answers.writing[part.toString()]) {
                isAnswered = true;
                pill.classList.add("answered");
            }
        } else if (skill === "speaking") {
            // Speaks are async indexedDB checks
            VstepDB.getAudioRecording(state.testId, part).then(blob => {
                if (blob) {
                    pill.classList.add("answered");
                }
            });
        }
    });
}

// ==========================================================================
// 12. Exam Submit & Scores Calculation
// ==========================================================================
async function submitExam() {
    // 1. Stop global timer interval
    if (state.globalInterval) {
        clearInterval(state.globalInterval);
        state.globalInterval = null;
    }
    
    // Stop listening audios
    stopListeningAudio();
    stopSpeakingSubTimer();
    
    // Remove scroll lock if it was active
    document.body.classList.remove("lock-scroll");
    
    // 2. Save final answers to IndexedDB
    await VstepDB.saveAnswers(state.testId, state.answers);
    
    // 3. Score calculation
    let listScore = 0;
    let readScore = 0;
    
    // Listening
    state.testData.listening.forEach(part => {
        part.questions.forEach(q => {
            const userAns = state.answers.listening[q.id];
            if (userAns === q.correctAnswer) {
                listScore++;
            }
        });
    });
    
    // Reading
    state.testData.reading.parts.forEach(part => {
        part.questions.forEach(q => {
            const userAns = state.answers.reading[q.id];
            if (userAns === q.correctAnswer) {
                readScore++;
            }
        });
    });
    
    // 4. Update results dashboard score text elements
    DOM.scoreListeningVal.textContent = listScore;
    DOM.scoreReadingVal.textContent = readScore;
    
    // Set time nộp bài
    const now = new Date();
    document.getElementById("result-submit-time").textContent = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')} - ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
    
    // 5. Swap screen to result dashboard
    DOM.examScreen.classList.remove("active");
    DOM.resultScreen.classList.add("active");
    
    // Hide details panel
    DOM.resultDetailsPanel.style.display = "none";
    
    // Attach buttons for detail listings
    document.querySelectorAll(".btn-view-skill-results").forEach(btn => {
        btn.addEventListener("click", () => {
            const skill = btn.dataset.target;
            renderResultDetails(skill);
        });
    });
    
    showToast("Bài thi của bạn đã được nộp!", "success");
}

function renderResultDetails(skill) {
    DOM.resultDetailsPanel.style.display = "block";
    
    const panelTitle = DOM.detailsPanelTitle;
    const body = DOM.detailsPanelBody;
    
    body.innerHTML = "";
    
    if (skill === "listening") {
        panelTitle.textContent = "Chi tiết bài làm - NGHE (LISTENING)";
        
        state.testData.listening.forEach(part => {
            const partHeader = document.createElement("div");
            partHeader.className = "part-results-divider";
            partHeader.innerHTML = `<h4 style="margin: 20px 0 10px 0; color: var(--color-violet); border-bottom: 2px solid var(--border-color); padding-bottom:6px;">${part.title.toUpperCase()}</h4>`;
            body.appendChild(partHeader);
            
            part.questions.forEach(q => {
                const qRow = document.createElement("div");
                qRow.className = "result-detail-q-row";
                
                const userAns = state.answers.listening[q.id] || "Không trả lời";
                const isCorrect = userAns === q.correctAnswer;
                
                qRow.innerHTML = `
                    <div class="result-q-meta">
                        <span>Câu hỏi ${q.id}</span>
                        <span class="result-badge ${isCorrect ? "correct" : "incorrect"}">${isCorrect ? "Đúng" : "Sai"}</span>
                    </div>
                    <p style="font-weight:600; font-size:14px; margin-bottom:8px;">${q.id}. ${q.question}</p>
                    <p style="font-size:12px; color: var(--text-muted); margin-bottom:8px;">Dịch nghĩa: ${q.translation}</p>
                    <div class="result-ans-info">
                        <div>Lựa chọn của bạn: <strong class="${isCorrect ? "text-emerald" : "text-red"}">${userAns}</strong></div>
                        <div>Đáp án đúng: <strong class="text-emerald">${q.correctAnswer} (${q.options[ord(q.correctAnswer)]})</strong></div>
                    </div>
                    
                    <button class="toggle-transcript-btn" onclick="toggleResultTranscript(${q.id})">
                        <i class="fa-solid fa-file-lines"></i> Xem giải thích & Transcript
                    </button>
                    
                    <div id="transcript-box-${q.id}" class="result-transcript-box" style="display:none;">
                        <p style="font-weight:700; margin-bottom:6px;">Audio Transcript:</p>
                        <p style="margin-bottom:10px; font-style:italic;">${q.transcript}</p>
                        <p style="font-weight:700; margin-bottom:6px;">Bản dịch nghĩa:</p>
                        <p style="color:var(--text-muted);">${q.transcriptTranslation}</p>
                    </div>
                `;
                body.appendChild(qRow);
            });
        });
    } else if (skill === "reading") {
        panelTitle.textContent = "Chi tiết bài làm - ĐỌC (READING)";
        
        state.testData.reading.parts.forEach(part => {
            const partHeader = document.createElement("div");
            partHeader.className = "part-results-divider";
            partHeader.innerHTML = `<h4 style="margin: 20px 0 10px 0; color: var(--color-emerald); border-bottom: 2px solid var(--border-color); padding-bottom:6px;">${part.title}</h4>`;
            body.appendChild(partHeader);
            
            part.questions.forEach(q => {
                const qRow = document.createElement("div");
                qRow.className = "result-detail-q-row";
                
                const userAns = state.answers.reading[q.id] || "Không trả lời";
                const isCorrect = userAns === q.correctAnswer;
                
                qRow.innerHTML = `
                    <div class="result-q-meta">
                        <span>Câu hỏi ${q.id}</span>
                        <span class="result-badge ${isCorrect ? "correct" : "incorrect"}">${isCorrect ? "Đúng" : "Sai"}</span>
                    </div>
                    <p style="font-weight:600; font-size:14px; margin-bottom:8px;">${q.id}. ${q.question}</p>
                    <div class="result-ans-info">
                        <div>Lựa chọn của bạn: <strong class="${isCorrect ? "text-emerald" : "text-red"}">${userAns}</strong></div>
                        <div>Đáp án đúng: <strong class="text-emerald">${q.correctAnswer} (${q.options[ord(q.correctAnswer)]})</strong></div>
                    </div>
                `;
                body.appendChild(qRow);
            });
        });
    } else if (skill === "writing") {
        panelTitle.textContent = "Bài làm của thí sinh & Bài mẫu - VIẾT (WRITING)";
        
        state.testData.writing.parts.forEach(part => {
            const userResponse = state.answers.writing[part.partId.toString()] || "Không làm bài";
            const wordCount = userResponse.trim().split(/\s+/).filter(w => w.length > 0).length;
            
            const div = document.createElement("div");
            div.className = "writing-response-view";
            div.innerHTML = `
                <h4 style="margin: 20px 0 10px 0; color: var(--color-amber); border-bottom: 2px solid var(--border-color); padding-bottom:6px;">${part.title}</h4>
                <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:#475569;">ĐỀ BÀI:</div>
                <div class="prompt-text-box" style="padding:14px; margin-bottom:16px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; line-height:1.6;">${part.prompt}</div>
                <div style="font-size:13px; font-weight:700; margin-bottom:6px; color:#475569;">BÀI LÀM CỦA BẠN (Số từ: <span class="text-violet" style="font-weight:800;">${wordCount}</span>):</div>
                <textarea readonly style="width:100%; min-height:120px; padding:12px; border:1px solid #cbd5e1; border-radius:8px; background:#f1f5f9; font-family:inherit; font-size:14px; margin-bottom:24px;">${userResponse}</textarea>
                
                <div class="model-solution-wrapper" style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); background: #fff; margin-bottom: 30px;">
                    <div style="background: #f8fafc; padding: 12px 16px; border-bottom: 1px solid #cbd5e1; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                        <div style="font-weight:800; color:#1e293b; font-size:14px; display:flex; align-items:center; gap:8px;">
                            <i class="fa-solid fa-lightbulb text-amber" style="font-size:16px;"></i> BÀI GIẢI MẪU THAM KHẢO
                        </div>
                        <div class="solution-tabs" style="display:flex; gap:8px; background:#e2e8f0; padding:4px; border-radius:8px;">
                            <button type="button" class="tab-btn active" data-target="b1-${part.partId}" style="padding:6px 16px; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; transition:all 0.2s; background:var(--color-violet); color:#fff;">🌟 Trình độ B1</button>
                            ${part.solutionB2 ? `<button type="button" class="tab-btn" data-target="b2-${part.partId}" style="padding:6px 16px; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; transition:all 0.2s; background:transparent; color:#475569;">🏆 Trình độ B2</button>` : ""}
                        </div>
                    </div>

                    <div class="tab-content" id="b1-${part.partId}" style="padding: 24px;">
                        <div style="margin-bottom:20px;">
                            <div style="font-size:12px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Bài viết mẫu B1</div>
                            <div style="font-size:15px; line-height:1.8; color:#1e293b; background:#fdf4ff; border-left:4px solid var(--color-violet); padding:18px; border-radius:6px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); white-space: pre-line;">${part.solutionB1 || ""}</div>
                        </div>
                        ${part.vocabularyB1 ? `
                        <div style="margin-bottom:20px;">
                            <div style="font-size:12px; font-weight:800; color:#059669; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-bookmark"></i> Từ vựng ghi điểm B1</div>
                            <div style="font-size:14px; line-height:1.7; color:#1e293b; background:#ecfdf5; border:1px solid #a7f3d0; padding:16px; border-radius:6px;">${part.vocabularyB1}</div>
                        </div>` : ""}
                        <div>
                            <div style="font-size:12px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-language"></i> Bản dịch tiếng Việt B1</div>
                            <div style="font-size:14px; line-height:1.7; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; padding:16px; border-radius:6px; white-space: pre-line;">${part.translationB1 || ""}</div>
                        </div>
                    </div>

                    ${part.solutionB2 ? `
                    <div class="tab-content" id="b2-${part.partId}" style="padding: 24px; display: none;">
                        <div style="margin-bottom:20px;">
                            <div style="font-size:12px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px;">Bài viết mẫu B2</div>
                            <div style="font-size:15px; line-height:1.8; color:#1e293b; background:#ecfdf5; border-left:4px solid #10b981; padding:18px; border-radius:6px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); white-space: pre-line;">${part.solutionB2}</div>
                        </div>
                        ${part.vocabularyB2 ? `
                        <div style="margin-bottom:20px;">
                            <div style="font-size:12px; font-weight:800; color:#059669; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-bookmark"></i> Từ vựng ghi điểm B2</div>
                            <div style="font-size:14px; line-height:1.7; color:#1e293b; background:#ecfdf5; border:1px solid #a7f3d0; padding:16px; border-radius:6px;">${part.vocabularyB2}</div>
                        </div>` : ""}
                        <div>
                            <div style="font-size:12px; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; display:flex; align-items:center; gap:6px;"><i class="fa-solid fa-language"></i> Bản dịch tiếng Việt B2</div>
                            <div style="font-size:14px; line-height:1.7; color:#475569; background:#f8fafc; border:1px solid #e2e8f0; padding:16px; border-radius:6px; white-space: pre-line;">${part.translationB2 || ""}</div>
                        </div>
                    </div>` : ""}
                </div>
            `;
            body.appendChild(div);

            const tabBtns = div.querySelectorAll(".tab-btn");
            tabBtns.forEach(btn => {
                btn.addEventListener("click", () => {
                    tabBtns.forEach(b => {
                        b.style.background = "transparent";
                        b.style.color = "#475569";
                        b.classList.remove("active");
                    });
                    btn.style.background = btn.textContent.includes("B1") ? "var(--color-violet)" : "#10b981";
                    btn.style.color = "#fff";
                    btn.classList.add("active");

                    div.querySelectorAll(".tab-content").forEach(c => c.style.display = "none");
                    const targetId = btn.getAttribute("data-target");
                    const targetEl = div.querySelector(`#${targetId}`);
                    if (targetEl) targetEl.style.display = "block";
                });
            });
        });
    } else if (skill === "speaking") {
        panelTitle.textContent = "Bài thu âm & Bài mẫu - NÓI (SPEAKING)";
        
        state.testData.speaking.parts.forEach(part => {
            const div = document.createElement("div");
            div.className = "speaking-audio-view";
            
            // Create a temporary element ID to render audio element
            const audioId = `speaking-playback-audio-${part.partId}`;
            
            div.innerHTML = `
                <h4 style="margin: 20px 0 10px 0; color: var(--color-pink); border-bottom: 2px solid var(--border-color); padding-bottom:6px;">${part.title}</h4>
                <div style="font-size:13px; font-weight:700; margin-bottom:6px;">ĐỀ BÀI:</div>
                <div class="prompt-text-box" style="padding:12px; margin-bottom:12px;">${part.prompt}</div>
                <div style="font-size:13px; font-weight:700; margin-bottom:6px;">BẢN THU ÂM CỦA BẠN:</div>
                <div id="speaking-playback-container-${part.partId}">
                    <p class="text-muted" style="font-size:12px; font-style:italic;"><i class="fa-solid fa-spinner animate-pulse"></i> Đang tải file thu âm từ IndexedDB...</p>
                </div>
                
                <div class="model-solution-box">
                    <p style="font-weight:800; color:var(--color-violet); margin-bottom:10px;"><i class="fa-solid fa-lightbulb"></i> Ý TƯỞNG GỢI Ý (SAMPLE SOLUTIONS):</p>
                    <div>${part.solution}</div>
                </div>
            `;
            body.appendChild(div);
            
            // Fetch audio blob from IndexedDB and render audio element
            VstepDB.getAudioRecording(state.testId, part.partId).then(blob => {
                const container = document.getElementById(`speaking-playback-container-${part.partId}`);
                if (blob) {
                    const audioUrl = URL.createObjectURL(blob);
                    container.innerHTML = `<audio controls id="${audioId}" src="${audioUrl}"></audio>`;
                } else {
                    container.innerHTML = `<p class="text-red" style="font-size:12px; font-weight:600;"><i class="fa-solid fa-triangle-exclamation"></i> Không có bản thu âm cho phần này.</p>`;
                }
            });
        });
    }
    
    // Scroll details panel into view
    DOM.resultDetailsPanel.scrollIntoView({ behavior: "smooth" });
}

// Global script helpers
window.toggleResultTranscript = function(qid) {
    const box = document.getElementById(`transcript-box-${qid}`);
    if (box) {
        if (box.style.display === "none") {
            box.style.display = "block";
        } else {
            box.style.display = "none";
        }
    }
};

// ==========================================================================
// 13. Common Utilities & Helper Functions
// ==========================================================================

// Display a simple modern toast message
function showToast(msg, type = "info") {
    // check if toast exists
    let toast = document.getElementById("toast-container");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast-container";
        toast.className = "toast-msg";
        document.body.appendChild(toast);
    }
    
    // Set icon based on type
    let iconClass = "fa-circle-info";
    if (type === "success") iconClass = "fa-circle-check";
    if (type === "error") iconClass = "fa-circle-xmark";
    
    toast.className = `toast-msg show toast-${type}`;
    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${msg}</span>`;
    
    // hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

// Convert seconds to mm:ss format
function formatTime(seconds) {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
}

// Character ordering index: ord('A') is 0, ord('B') is 1, etc.
function ord(char) {
    return char.charCodeAt(0) - 65;
}

// Fast DOM label formatter
function fLabel(val) {
    return val.replace(/\s+/g, '-').toLowerCase();
}

// ==========================================================================
// 14. Password Verification & Exam Lock screen logic
// ==========================================================================
function attachLockGateListeners() {
    // Show/Hide password toggle
    DOM.btnToggleLockPwd.addEventListener("click", () => {
        const input = DOM.lockPassword;
        const icon = DOM.btnToggleLockPwd.querySelector("i");
        if (input.type === "password") {
            input.type = "text";
            icon.className = "fa-solid fa-eye-slash";
        } else {
            input.type = "password";
            icon.className = "fa-solid fa-eye";
        }
    });

    // Handle unlocking action
    async function handleUnlock() {
        const studentName = DOM.lockStudentName.value.trim() || "Thí sinh";
        const studentClass = DOM.lockStudentClass.value.trim() || "12A1";
        const accountId = DOM.lockTestId.value; // e.g. "VSTEP01"
        const password = DOM.lockPassword.value;
        
        DOM.lockErrorMsg.style.display = "none";
        
        if (TEST_PASSWORDS[accountId] === password) {
            // Correct password
            const testId = accountId.replace("VSTEP", "VSTEPTEST"); // e.g. "VSTEP01" -> "VSTEPTEST01"
            
            sessionStorage.setItem("unlocked_test_" + testId, "true");
            sessionStorage.setItem("unlocked_active_test", testId);
            sessionStorage.setItem("unlocked_student_name", studentName);
            sessionStorage.setItem("unlocked_student_class", studentClass);
            sessionStorage.setItem("unlocked_candidate_account", accountId);
            
            state.testId = testId;
            state.candidateCode = testId;
            state.candidateName = studentName;
            state.candidateClass = studentClass;
            state.candidateAccount = accountId;
            
            // Clear password field
            DOM.lockPassword.value = "";
            
            // Hide lock screen overlay, show prep screen
            DOM.lockScreen.classList.remove("active");
            DOM.prepScreen.classList.add("active");
            
            // Load and init data
            await initUnlockedExam();
            
            showToast("Mở khóa đề thi thành công!", "success");
        } else {
            // Incorrect password
            DOM.lockErrorMsg.style.display = "flex";
            DOM.lockErrorText.textContent = "Mật khẩu mở khóa không chính xác!";
            
            // Shake effect
            const card = DOM.lockScreen.querySelector(".lock-card");
            card.classList.add("shake");
            
            // Remove shake class after animation finishes
            setTimeout(() => {
                card.classList.remove("shake");
            }, 400);
            
            DOM.lockPassword.select();
            DOM.lockPassword.focus();
        }
    }
    
    DOM.btnUnlockExam.addEventListener("click", handleUnlock);
    
    // Press Enter to submit
    DOM.lockPassword.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            handleUnlock();
        }
    });
}


// Added to fix missing function error
function stopListeningAudio() {
    if (state.listeningAudioElement) {
        state.listeningAudioElement.pause();
        state.listeningAudioElement = null;
    }
    if (state.activeListeningAudios) {
        for (let audioId in state.activeListeningAudios) {
            if (state.activeListeningAudios[audioId]) {
                state.activeListeningAudios[audioId].pause();
            }
        }
        state.activeListeningAudios = {};
    }
}

// Added Listening Single Play Listener & Helpers
if (DOM.btnListeningPlay) {
    DOM.btnListeningPlay.addEventListener("click", () => {
        const partData = state.testData.listening.find(p => p.partId === state.activePart);
        if (!partData || !partData.audioUrl) return;
        
        if (state.listeningAudioPlayed[state.activePart]) {
            showToast("Bạn đã nghe bài này rồi. Thí sinh chỉ được nghe 1 lần.", "warning");
            return;
        }
        
        if (!state.listeningAudioElement) {
            const safeUrl = encodeURI(partData.audioUrl);
            state.listeningAudioElement = new Audio(safeUrl);
            state.listeningAudioElement.addEventListener("timeupdate", () => {
                if (state.listeningAudioElement && state.listeningAudioElement.duration) {
                    const pct = (state.listeningAudioElement.currentTime / state.listeningAudioElement.duration) * 100;
                    DOM.listeningProgressBar.style.width = `${pct}%`;
                    DOM.listeningPlayerTime.textContent = formatAudioTime(state.listeningAudioElement.currentTime) + " / " + formatAudioTime(state.listeningAudioElement.duration);
                }
            });
            state.listeningAudioElement.addEventListener("ended", () => {
                state.listeningAudioPlayed[state.activePart] = true;
                DOM.btnListeningPlay.disabled = true;
                DOM.btnListeningPlay.innerHTML = "<i class='fa-solid fa-lock'></i>";
                showToast("Đã nghe xong băng Audio.", "info");
            });
            state.listeningAudioElement.addEventListener("error", (e) => {
                showToast("Lỗi tải file âm thanh. Vui lòng kiểm tra lại file âm thanh.", "error");
            });
        }
        
        state.listeningAudioElement.play().then(() => {
            DOM.btnListeningPlay.innerHTML = "<i class='fa-solid fa-volume-high'></i>";
            showToast("Bắt đầu phát Audio bài nghe...", "info");
        }).catch(err => {
            console.error("Audio play error:", err);
            showToast("Không thể phát audio: " + err.message, "error");
        });
    });
}

function formatAudioTime(secs) {
    if (isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
}
