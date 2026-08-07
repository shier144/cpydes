'use strict';

// ========== AI Shared State ==========
// Shared state container for AI chat modules.
// All modules access state via window._aiShared.

(function () {
    var S = {
        // --- Chat state ---
        chatHistory: [],
        currentChatId: null,
        aiModels: [],
        selectedModel: 'default',
        typingTimer: null,

        // --- Mode state (chat / image / video) ---
        aiMode: 'chat',
        lastChatIdByMode: { chat: null, image: null, video: null },
        chatImageMode: false,
        selectedModelByMode: { chat: 'default', image: '', video: '' },
        backendDefaults: { chat: '', image: '', video: '' },
        modelDetections: {},

        // --- Video polling state ---
        videoPolling: null,

        // --- Generation state ---
        isGenerating: false,
        isSending: false,
        pollRegistry: {},

        // --- Per-chat streaming state (supports multi-task) ---
        streamingChats: {},

        // --- Image/Video generation history ---
        imageHistory: [],
        videoHistory: [],

        // --- DOM element caches ---
        els: {
            messages: null,
            welcome: null,
            input: null,
            sendBtn: null,
            stopBtn: null,
            inputCounter: null,
            sidebar: null,
            chatList: null,
            chatListEmpty: null,
            modelName: null,
            modelDropdown: null,
            modelSelector: null,
            themeIcon: null,
            headerSub: null
        },

        // --- Constants ---
        GEN_HISTORY_KEY: 'cpydes_ai_gen_history',
        STREAM_STORAGE_KEY: 'cpydes_ai_streaming',
        MAX_CHAT_HISTORY: 200,
        SCROLL_NEAR_THRESHOLD: 120,

        // --- Model dropdown close handler ---
        modelDropdownCloseHandler: null,

        // --- Internal cross-module functions ---
        fn: {}
    };

    window._aiShared = S;
})();
