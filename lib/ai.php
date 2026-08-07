<?php
// 由 api.php 机械拆分而来（AI 任务列表/配置/聊天流式/图片视频生成与轮询），仅供 api.php 引入
if (!defined('DATA_FILE')) { http_response_code(403); exit; }

/**
 * 获取所有后台任务列表
 */
function handleAiTaskList() {
    $dir = getTaskStatusDir();
    $tasks = [];

    cleanupExpiredTasks();

    foreach (glob($dir . '/*.json') as $file) {
        if (filemtime($file) < time() - 7200) {
            continue;
        }
        
        $content = @file_get_contents($file);
        if ($content === false) {
            continue;
        }
        $task = json_decode($content, true);
        if (is_array($task) && isset($task['taskId'])) {
            if ($task['status'] !== 'completed' || ($task['updatedAt'] ?? 0) > time() - 3600) {
                $tasks[] = $task;
            }
        }
    }
    
    usort($tasks, function($a, $b) {
        return ($b['startTime'] ?? 0) - ($a['startTime'] ?? 0);
    });
    
    echo json_encode([
        'success' => true,
        'tasks' => $tasks
    ]);
}

function handleAiCancelTask($taskId) {
    $dir = getTaskStatusDir();
    $file = $dir . '/' . $taskId . '.json';
    $lockFile = $dir . '/' . $taskId . '.lock';

    if (!file_exists($file)) {
        echo json_encode(['success' => false, 'error' => '任务不存在']);
        exit;
    }

    $content = @file_get_contents($file);
    $task = $content !== false ? json_decode($content, true) : null;
    if (!is_array($task)) {
        echo json_encode(['success' => false, 'error' => '任务数据无效']);
        exit;
    }

    if ($task['status'] === 'completed' || $task['status'] === 'failed') {
        echo json_encode(['success' => false, 'error' => '任务已结束，无需取消']);
        exit;
    }

    $lockFp = @fopen($lockFile, 'c');
    $ownLock = false;
    if ($lockFp !== false) {
        @flock($lockFp, LOCK_EX);
        $ownLock = true;
    }

    try {
        saveTaskStatus($taskId, 'failed', ['error' => '任务已取消'], $task['type'] ?? 'image', $lockFp);
    } finally {
        if ($lockFp !== false && $ownLock) {
            @flock($lockFp, LOCK_UN);
            @fclose($lockFp);
        }
    }

    echo json_encode(['success' => true, 'message' => '任务已取消']);
}

/** @var array|null 缓存的 AI 配置 */
$_aiConfigCache = null;

function loadAiConfig() {
    global $_aiConfigCache;
    if ($_aiConfigCache !== null) return $_aiConfigCache;
    if (!file_exists(AI_CONFIG_FILE)) {
        $srcFile = defined('LIBRARY_SETTINGS_FILE') && file_exists(LIBRARY_SETTINGS_FILE)
            ? LIBRARY_SETTINGS_FILE
            : (file_exists(DATA_FILE) ? DATA_FILE : null);
        $aiSettings = null;
        if ($srcFile !== null) {
            $raw = @file_get_contents($srcFile);
            $data = $raw !== false ? json_decode($raw, true) : null;
            if (isset($data['settings']['ai'])) {
                $aiSettings = $data['settings']['ai'];
            } elseif ($srcFile === LIBRARY_SETTINGS_FILE && isset($data['ai'])) {
                $aiSettings = $data['ai'];
            }
        }
        if ($aiSettings !== null) {
            $cfg = $aiSettings;
            if (empty($cfg)) {
                $_aiConfigCache = getDefaultAiSettings();
            } else {
                foreach ($cfg['models'] as &$m) {
                    if (empty($m['type'])) {
                        if (strpos($m['id'], 'image') !== false || strpos($m['modelName'] ?? '', 'image') !== false) {
                            $m['type'] = 'image';
                        } elseif (strpos($m['id'], 'video') !== false || strpos($m['modelName'] ?? '', 'video') !== false) {
                            $m['type'] = 'video';
                        } elseif (strpos($m['id'], 'flash') !== false) {
                            $m['type'] = 'chat';
                        }
                    }
                }
                unset($m);
                $_aiConfigCache = $cfg;
            }
            saveJsonFile(AI_CONFIG_FILE, $_aiConfigCache, JSON_UNESCAPED_UNICODE);
            return $_aiConfigCache;
        }
        $_aiConfigCache = getDefaultAiSettings();
        saveJsonFile(AI_CONFIG_FILE, $_aiConfigCache, JSON_UNESCAPED_UNICODE);
        return $_aiConfigCache;
    }
    $raw = @file_get_contents(AI_CONFIG_FILE);
    $_aiConfigCache = $raw !== false ? json_decode($raw, true) : null;
    if (!$_aiConfigCache) {
        $_aiConfigCache = getDefaultAiSettings();
    } else {
        if (empty($_aiConfigCache['defaultImageModel']) && !empty($_aiConfigCache['models'])) {
            foreach ($_aiConfigCache['models'] as $m) {
                if (!empty($m['type']) && $m['type'] === 'image') {
                    $_aiConfigCache['defaultImageModel'] = $m['id'];
                    break;
                }
            }
        }
        if (empty($_aiConfigCache['defaultVideoModel']) && !empty($_aiConfigCache['models'])) {
            foreach ($_aiConfigCache['models'] as $m) {
                if (!empty($m['type']) && $m['type'] === 'video') {
                    $_aiConfigCache['defaultVideoModel'] = $m['id'];
                    break;
                }
            }
        }
    }
    return $_aiConfigCache;
}

function saveAiConfig($config) {
    global $_aiConfigCache;
    $ok = saveJsonFile(AI_CONFIG_FILE, $config, JSON_UNESCAPED_UNICODE);
    if ($ok) {
        $_aiConfigCache = $config;
    }
    return $ok;
}

function getDefaultAiSettings() {
    return [
        'enabled' => false,
        'models' => [
            [
                'id' => 'default',
                'name' => '默认模型',
                'desc' => '通用对话，适合大多数场景',
                'apiUrl' => '',
                'apiKey' => '',
                'modelName' => '',
                'maxTokens' => 8192,
                'temperature' => 0.7
            ]
        ],
        'systemPrompt' => '你是一个智能助手，可以帮助用户撰写文案、优化表达、生成创意灵感。',
        'defaultModel' => 'default',
        'defaultImageModel' => '',
        'defaultVideoModel' => ''
    ];
}

function validateAiSettings($settings) {
    $validated = getDefaultAiSettings();
    if (isset($settings['enabled'])) {
        $validated['enabled'] = (bool)$settings['enabled'];
    }
    if (isset($settings['systemPrompt'])) {
        $validated['systemPrompt'] = substr($settings['systemPrompt'], 0, 2000);
    }
    if (isset($settings['defaultModel'])) {
        $validated['defaultModel'] = substr($settings['defaultModel'], 0, 100);
    }
    if (isset($settings['defaultImageModel'])) {
        $validated['defaultImageModel'] = substr($settings['defaultImageModel'], 0, 100);
    }
    if (isset($settings['defaultVideoModel'])) {
        $validated['defaultVideoModel'] = substr($settings['defaultVideoModel'], 0, 100);
    }
    if (isset($settings['models']) && is_array($settings['models'])) {
        $validated['models'] = [];
        foreach ($settings['models'] as $model) {
            $id = isset($model['id']) ? preg_replace('/[^a-zA-Z0-9_.\\-]/', '', $model['id']) : 'model_' . uniqid();
            $name = isset($model['name']) ? substr($model['name'], 0, 50) : '未命名模型';
            $desc = isset($model['desc']) ? substr($model['desc'], 0, 100) : '';
            $apiUrl = isset($model['apiUrl']) ? filter_var($model['apiUrl'], FILTER_SANITIZE_URL) : '';
            $apiKey = isset($model['apiKey']) ? substr($model['apiKey'], 0, 500) : '';
            $modelName = isset($model['modelName']) && $model['modelName'] !== '' ? $model['modelName'] : '';
            $type = isset($model['type']) && in_array($model['type'], ['chat', 'image', 'video'], true) ? $model['type'] : 'chat';
            $maxTokens = isset($model['maxTokens']) ? min(1000000, max(100, (int)$model['maxTokens'])) : 8192;
            $temperature = isset($model['temperature']) ? min(2.0, max(0.0, (float)$model['temperature'])) : 0.7;
            $validatedModel = [
                'id' => $id,
                'name' => $name,
                'desc' => $desc,
                'apiUrl' => $apiUrl,
                'apiKey' => $apiKey,
                'modelName' => $modelName,
                'type' => $type,
                'maxTokens' => $maxTokens,
                'temperature' => $temperature
            ];
            $validated['models'][] = $validatedModel;
        }
    }
    return $validated;
}

function buildAiEndpoint($baseUrl, $type) {
    if (empty($baseUrl)) return '';
    $baseUrl = rtrim($baseUrl, '/');
    $knownEndpoints = ['/chat/completions', '/images/generations', '/videos'];
    foreach ($knownEndpoints as $ep) {
        if (substr($baseUrl, -strlen($ep)) === $ep) {
            $baseUrl = substr($baseUrl, 0, -strlen($ep));
            break;
        }
    }
    switch ($type) {
        case 'chat':
            return $baseUrl . '/chat/completions';
        case 'image':
            return $baseUrl . '/images/generations';
        case 'video':
            return $baseUrl . '/videos';
        default:
            return $baseUrl;
    }
}

function _initCurl($apiUrl, $apiKey, $timeout = 60, $isPost = true) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $apiKey
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_TIMEOUT_MS, $timeout * 1000);
    if ($isPost) {
        curl_setopt($ch, CURLOPT_POST, true);
    }
    return $ch;
}

function getModelName($modelConfig) {
    if (!empty($modelConfig['modelName'])) {
        return $modelConfig['modelName'];
    }
    throw new RuntimeException('模型名称不能为空，请在管理后台配置', 400);
}

function handleAiChatStream($modelConfig, $messages, $aiSettings) {
    session_write_close();
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('Connection: keep-alive');
    header('X-Accel-Buffering: no');
    @set_time_limit(0);
    @ignore_user_abort(true);
    @ini_set('memory_limit', '512M');
    $safeFlush = function () {
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        @flush();
    };
    echo ": keep-alive\n\n";
    $safeFlush();
    $apiUrl = buildAiEndpoint($modelConfig['apiUrl'], 'chat');
    $apiKey = $modelConfig['apiKey'];
    $modelName = getModelName($modelConfig);
    if (empty($apiUrl) || empty($apiKey)) {
        echo "data: " . json_encode(['type' => 'error', 'message' => 'AI 模型配置不完整，请联系管理员']) . "\n\n";
        echo "data: " . json_encode(['type' => 'done']) . "\n\n";
        $safeFlush();
        return;
    }
    $apiMessages = [];
    if (!empty($aiSettings['systemPrompt'])) {
        $apiMessages[] = ['role' => 'system', 'content' => $aiSettings['systemPrompt']];
    }
    foreach ($messages as $msg) {
        $apiMessages[] = ['role' => $msg['role'], 'content' => $msg['content']];
    }
    $requestBody = [
        'model' => $modelName,
        'messages' => $apiMessages,
        'max_tokens' => min($modelConfig['maxTokens'], 65536),
        'temperature' => $modelConfig['temperature'],
        'stream' => true
    ];
    $maxRetries = 2;
    $retryDelays = [1, 3];
    $result = false;
    $httpCode = 0;
    $error = '';
    $fullContent = '';
    $streamStarted = false;
    $errorBody = '';
    for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
        if ($attempt > 0) {
            echo ": retry attempt $attempt\n\n";
            $safeFlush();
            usleep($retryDelays[$attempt - 1] * 1000000);
            $fullContent = '';
            $streamStarted = false;
            $errorBody = '';
        }
        $lastActivity = time();
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $apiUrl);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($requestBody));
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, false);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey
        ]);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
        curl_setopt($ch, CURLOPT_TIMEOUT, 600);
        curl_setopt($ch, CURLOPT_LOW_SPEED_LIMIT, 1);
        curl_setopt($ch, CURLOPT_LOW_SPEED_TIME, 300);
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function($ch, $data) use (&$fullContent, &$streamStarted, &$errorBody, $safeFlush, &$lastActivity) {
            $lastActivity = time();
            if (!$streamStarted) {
                $trimmed = ltrim($data);
                if (strpos($trimmed, 'data:') === 0 || strpos($trimmed, 'event:') === 0) {
                    $streamStarted = true;
                } elseif ($trimmed !== '') {
                    $errorBody .= $data;
                    return strlen($data);
                }
            }
            $lines = explode("\n", $data);
            foreach ($lines as $line) {
                $line = trim($line);
                if (strpos($line, 'data: ') === 0) {
                    $jsonStr = substr($line, 6);
                    if ($jsonStr === '[DONE]') {
                        echo "data: " . json_encode(['type' => 'done']) . "\n\n";
                        $safeFlush();
                        return strlen($data);
                    }
                    $jsonData = json_decode($jsonStr, true);
                    if ($jsonData) {
                        if (isset($jsonData['error'])) {
                            $errMsg = isset($jsonData['error']['message']) ? $jsonData['error']['message'] : 'AI 服务返回错误';
                            echo "data: " . json_encode(['type' => 'error', 'message' => $errMsg]) . "\n\n";
                            $safeFlush();
                        } elseif (isset($jsonData['choices'][0]['delta']['content'])) {
                            $content = $jsonData['choices'][0]['delta']['content'];
                            $fullContent .= $content;
                            echo "data: " . json_encode(['type' => 'chunk', 'content' => $content]) . "\n\n";
                            $safeFlush();
                        }
                    }
                }
            }
            return strlen($data);
        });
        curl_setopt($ch, CURLOPT_NOPROGRESS, false);
        curl_setopt($ch, CURLOPT_PROGRESSFUNCTION, function($ch, $dlSize, $dlNow, $ulSize, $ulNow) use (&$lastActivity, $safeFlush) {
            $now = time();
            if ($now - $lastActivity >= 15) {
                echo ": ping\n\n";
                $safeFlush();
                $lastActivity = $now;
            }
            return 0;
        });
        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        $isRetryable = false;
        if ($result === false && $attempt < $maxRetries) {
            $retryableErrors = ['SSL_connect', 'Connection was reset', 'Connection refused', 'Operation timed out', 'Connection timed out', 'Failed to connect', 'Connection reset by peer'];
            foreach ($retryableErrors as $re) {
                if (stripos($error, $re) !== false) {
                    $isRetryable = true;
                    break;
                }
            }
        }
        if ($isRetryable) continue;
        break;
    }
    if ($result === false || $httpCode !== 200 || (!$streamStarted && $errorBody)) {
        $errorMsg = 'AI 服务请求失败';
        if ($httpCode === 401) $errorMsg = 'API 密钥无效';
        elseif ($httpCode === 429) $errorMsg = '请求过于频繁，请稍后重试';
        elseif ($httpCode >= 500) $errorMsg = 'AI 服务暂时不可用';
        elseif ($error) {
            if (stripos($error, 'SSL') !== false || stripos($error, 'Connection') !== false) {
                $errorMsg = 'AI 服务连接失败，可能是网络波动，请稍后重试';
            } else {
                $errorMsg = '网络错误，请稍后重试';
            }
        }
        if ($errorBody) {
            $decodedErr = json_decode($errorBody, true);
            if ($decodedErr && isset($decodedErr['error']['message'])) {
                if ($errorMsg === 'AI 服务请求失败') {
                    $errorMsg = $decodedErr['error']['message'];
                } else {
                    $errorMsg .= '：' . $decodedErr['error']['message'];
                }
            } elseif (strlen($errorBody) <= 500) {
                if ($errorMsg === 'AI 服务请求失败') {
                    $errorMsg = trim($errorBody);
                } else {
                    $errorMsg .= '：' . trim($errorBody);
                }
            }
        }
        echo "data: " . json_encode(['type' => 'error', 'message' => $errorMsg]) . "\n\n";
    }
    echo "data: " . json_encode(['type' => 'done']) . "\n\n";
    $safeFlush();
}

function findAiModelConfig($aiSettings, $modelId) {
    $models = isset($aiSettings['models']) ? $aiSettings['models'] : [];
    foreach ($models as $m) {
        if ($m['id'] === $modelId) {
            return $m;
        }
    }
    if (!empty($models)) {
        return $models[0];
    }
    return null;
}

function requireAiAccess() {
    if (isBackendAuthed()) {
        return true;
    }
    $currentUser = getCurrentUser();
    if (!$currentUser) {
        if (!isLibraryProtectionEnabled()) {
            if (guestHasPermission('ai.use')) {
                return true;
            }
            echo json_encode(['success' => false, 'error' => 'AI 功能未对访客开放', 'needsPermission' => true]);
            return false;
        }
        if (isAllowGuestAccess()) {
            if (guestHasPermission('ai.use')) {
                return true;
            }
            echo json_encode(['success' => false, 'error' => 'AI 功能未对访客开放', 'needsPermission' => true]);
            return false;
        }
        echo json_encode(['success' => false, 'error' => '请先登录账户后使用 AI 功能', 'needsLogin' => true]);
        return false;
    }
    if (!hasUserPermission('ai.use')) {
        echo json_encode(['success' => false, 'error' => '没有 AI 功能使用权限', 'needsPermission' => true]);
        return false;
    }
    return true;
}

function getEnabledAiSettings() {
    $aiSettings = loadAiConfig();
    if (empty($aiSettings['enabled'])) {
        echo json_encode(['success' => false, 'error' => 'AI 功能未启用']);
        return null;
    }
    return $aiSettings;
}

function getTaskStatusDir() {
    $dir = SITE_ROOT . 'data/tasks';
    if (!file_exists($dir)) {
        @mkdir($dir, 0755, true);
    }
    $htaccess = $dir . '/.htaccess';
    if (!file_exists($htaccess)) {
        file_put_contents($htaccess, "Deny from all\n");
    }
    $index = $dir . '/index.html';
    if (!file_exists($index)) {
        file_put_contents($index, '');
    }
    return $dir;
}

function getTaskLockFile($taskId) {
    return getTaskStatusDir() . '/' . $taskId . '.lock';
}

function tryLockTask($taskId) {
    $lockFile = getTaskLockFile($taskId);
    $lockHandle = fopen($lockFile, 'c');
    if (!$lockHandle) {
        return false;
    }
    $locked = flock($lockHandle, LOCK_EX | LOCK_NB);
    if (!$locked) {
        fclose($lockHandle);
        return false;
    }
    return $lockHandle;
}

function unlockTask($lockHandle) {
    if (!is_resource($lockHandle)) return;
    flock($lockHandle, LOCK_UN);
    fclose($lockHandle);
}

function saveTaskStatus($taskId, $status, $data = [], $type = 'image', $lockHandle = null) {
    $dir = getTaskStatusDir();
    $file = $dir . '/' . $taskId . '.json';
    $lockFile = $dir . '/' . $taskId . '.lock';
    $ownLock = false;
    $lockFp = $lockHandle;
    if (!$lockFp) {
        $lockFp = @fopen($lockFile, 'c');
        if ($lockFp !== false) {
            @flock($lockFp, LOCK_EX);
            $ownLock = true;
        }
    }
    try {
        $existingData = null;
        if (file_exists($file)) {
            $rawExisting = @file_get_contents($file);
            $existingData = $rawExisting !== false ? json_decode($rawExisting, true) : null;
        }
        $mergedData = $data;
        if (is_array($existingData) && isset($existingData['data']) && is_array($existingData['data'])) {
            $preserveFields = ['prompt', 'modelId', 'imageUrl', 'size', 'n', 'modelName'];
            foreach ($preserveFields as $field) {
                if ((!array_key_exists($field, $mergedData) || $mergedData[$field] === '') && 
                    array_key_exists($field, $existingData['data']) && $existingData['data'][$field] !== '') {
                    $mergedData[$field] = $existingData['data'][$field];
                }
            }
        }
        $statusData = [
            'taskId' => $taskId,
            'type' => $type,
            'status' => $status,
            'data' => $mergedData,
            'startTime' => $existingData['startTime'] ?? time(),
            'endTime' => ($status === 'completed' || $status === 'failed') ? time() : null,
            'updatedAt' => time()
        ];
        cpydes_json_save_atomic($file, $statusData, JSON_UNESCAPED_UNICODE);
    } finally {
        if ($lockFp !== false && $ownLock) {
            @flock($lockFp, LOCK_UN);
            @fclose($lockFp);
        }
    }
}

function getTaskStatus($taskId) {
    static $cache = [];
    $dir = getTaskStatusDir();
    $file = $dir . '/' . $taskId . '.json';
    if (!file_exists($file)) {
        return null;
    }
    clearstatcache(true, $file);
    $mtime = filemtime($file);
    if (isset($cache[$taskId]) && $cache[$taskId][0] === $mtime) {
        return $cache[$taskId][1];
    }
    $raw = @file_get_contents($file);
    $data = $raw !== false ? json_decode($raw, true) : null;
    $cache[$taskId] = [$mtime, $data];
    return $data;
}

function cleanupExpiredTasks() {
    $dir = getTaskStatusDir();
    $expireTime = time() - 7200;
    foreach (glob($dir . '/*.json') as $file) {
        if (@filemtime($file) < $expireTime) {
            @unlink($file);
        }
    }
}

function handleAiImageGeneration($modelConfig, $prompt, $size, $n) {
    $apiUrl = buildAiEndpoint($modelConfig['apiUrl'], 'image');
    $apiKey = $modelConfig['apiKey'];
    $modelName = getModelName($modelConfig);
    if (empty($apiUrl) || empty($apiKey)) {
        echo json_encode(['success' => false, 'error' => '图片模型配置不完整，请联系管理员']);
        return;
    }
    $taskId = 'img-' . time() . '-' . bin2hex(random_bytes(8));
    $taskData = [
        'modelId' => $modelConfig['id'],
        'prompt' => $prompt,
        'size' => $size,
        'n' => $n
    ];
    saveTaskStatus($taskId, 'pending', $taskData, 'image');
    ignore_user_abort(true);
    set_time_limit(180);
    ini_set('memory_limit', '256M');
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
        @apache_setenv('dont-vary', '1');
    }
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    $jsonResponse = json_encode([
        'success' => true,
        'taskId' => $taskId,
        'status' => 'pending'
    ]);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Length: ' . strlen($jsonResponse));
    header('Connection: close');
    header('X-Accel-Buffering: no');
    echo $jsonResponse;
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    ob_start();
    executeImageGeneration($taskId);
    ob_end_clean();
}

function executeImageGeneration($taskId) {
    $logFile = SITE_ROOT . 'data/tasks/worker.log';
    file_put_contents($logFile, "[" . date('Y-m-d H:i:s') . "] executeImageGeneration: taskId={$taskId}\n", FILE_APPEND | LOCK_EX);
    $lockHandle = tryLockTask($taskId);
    file_put_contents($logFile, "[" . date('Y-m-d H:i:s') . "] tryLockTask result: " . ($lockHandle ? 'success' : 'failed') . "\n", FILE_APPEND | LOCK_EX);
    if (!$lockHandle) {
        file_put_contents($logFile, "[" . date('Y-m-d H:i:s') . "] Lock failed, exiting\n", FILE_APPEND | LOCK_EX);
        return;
    }
    try {
        $status = getTaskStatus($taskId);
        file_put_contents($logFile, "[" . date('Y-m-d H:i:s') . "] getTaskStatus: " . ($status ? json_encode($status['status']) : 'null') . "\n", FILE_APPEND | LOCK_EX);
        if (!$status || $status['status'] !== 'pending') {
            file_put_contents($logFile, "[" . date('Y-m-d H:i:s') . "] Status not pending, exiting\n", FILE_APPEND | LOCK_EX);
            unlockTask($lockHandle);
            return;
        }
        saveTaskStatus($taskId, 'processing', [], 'image', $lockHandle);
        file_put_contents($logFile, "[" . date('Y-m-d H:i:s') . "] Status updated to processing\n", FILE_APPEND | LOCK_EX);
        $data = $status['data'];
        $modelId = $data['modelId'];
        $prompt = $data['prompt'];
        $size = $data['size'];
        $n = $data['n'];
        $aiSettings = loadAiConfig();
        $modelConfig = findAiModelConfig($aiSettings, $modelId);
        if (!$modelConfig) {
            saveTaskStatus($taskId, 'failed', ['error' => '模型配置不存在'], 'image', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $apiUrl = buildAiEndpoint($modelConfig['apiUrl'], 'image');
        $apiKey = $modelConfig['apiKey'];
        $modelName = getModelName($modelConfig);
        if (empty($apiUrl) || empty($apiKey)) {
            saveTaskStatus($taskId, 'failed', ['error' => '图片模型配置不完整'], 'image', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $requestBody = [
            'model' => $modelName,
            'prompt' => $prompt,
            'n' => $n,
        ];
        if (!empty($size)) {
            $requestBody['size'] = $size;
        }
        $requestBody['extra_body'] = ['response_format' => 'url'];
        $ch = _initCurl($apiUrl, $apiKey, 300, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($requestBody));
        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($result === false) {
            saveTaskStatus($taskId, 'failed', ['error' => '图片生成请求失败：' . $error], 'image', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $decoded = json_decode($result, true);
        $rawErrorDetail = '';
        if ($decoded && isset($decoded['error']['message'])) {
            $rawErrorDetail = $decoded['error']['message'];
        }
        if ($httpCode !== 200 || (!$decoded && $result !== '')) {
            $errMsg = '图片生成失败';
            if (!empty($rawErrorDetail)) {
                $errMsg .= '：' . $rawErrorDetail;
            } elseif ($result && strlen($result) <= 300 && empty($rawErrorDetail)) {
                $errMsg .= '：' . trim($result);
            }
            saveTaskStatus($taskId, 'failed', ['error' => $errMsg, 'httpCode' => $httpCode], 'image', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        if (!empty($decoded['error']['message'])) {
            saveTaskStatus($taskId, 'failed', ['error' => '图片生成失败：' . $decoded['error']['message']], 'image', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $images = [];
        if (isset($decoded['data']) && is_array($decoded['data'])) {
            foreach ($decoded['data'] as $item) {
                if (isset($item['url'])) {
                    $images[] = ['url' => $item['url']];
                } elseif (isset($item['b64_json'])) {
                    $b64Data = $item['b64_json'];
                    try {
                        $imgDirReal = realpath(AI_OUTPUT_DIR);
                        if ($imgDirReal !== false) {
                            $filename = 'ai-img-' . time() . '-' . bin2hex(random_bytes(4)) . '.png';
                            $filepath = AI_OUTPUT_DIR . '/' . $filename;
                            if (file_put_contents($filepath, base64_decode($b64Data, true))) {
                                $images[] = ['url' => 'ai-output/' . $filename];
                            } else {
                                error_log("Failed to save AI generated image to {$filepath}. Falling back to base64.");
                                $images[] = ['b64' => $b64Data];
                            }
                        } else {
                            $images[] = ['b64' => $b64Data];
                        }
                    } catch (\Throwable $e) {
                        $images[] = ['b64' => $b64Data];
                    }
                }
            }
        }
        if (empty($images)) {
            saveTaskStatus($taskId, 'failed', ['error' => '未返回图片结果'], 'image', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        saveTaskStatus($taskId, 'completed', ['images' => $images, 'prompt' => $prompt], 'image', $lockHandle);
    } catch (\Throwable $e) {
        saveTaskStatus($taskId, 'failed', ['error' => '图片生成异常：' . $e->getMessage()], 'image', $lockHandle);
    } finally {
        unlockTask($lockHandle);
    }
}

function handleAiImageStatus($taskId) {
    if (mt_rand(1, 20) === 1) {
        cleanupExpiredTasks();
    }
    $status = getTaskStatus($taskId);
    if (!$status) {
        echo json_encode(['success' => false, 'error' => '任务不存在或已过期']);
        return;
    }
    echo json_encode([
        'success' => true,
        'taskId' => $status['taskId'],
        'status' => $status['status'],
        'data' => isset($status['data']) ? $status['data'] : []
    ]);
}

function handleAiVideoGeneration($modelConfig, $prompt, $imageUrl) {
    $apiUrl = buildAiEndpoint($modelConfig['apiUrl'], 'video');
    $apiKey = $modelConfig['apiKey'];
    $modelName = getModelName($modelConfig);
    if (empty($apiUrl) || empty($apiKey)) {
        echo json_encode(['success' => false, 'error' => '视频模型配置不完整，请联系管理员']);
        return;
    }
    $taskId = 'vid-' . time() . '-' . bin2hex(random_bytes(8));
    $taskData = [
        'modelId' => $modelConfig['id'],
        'prompt' => $prompt,
        'imageUrl' => $imageUrl
    ];
    saveTaskStatus($taskId, 'pending', $taskData, 'video');
    ignore_user_abort(true);
    set_time_limit(480);
    ini_set('memory_limit', '256M');
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
        @apache_setenv('dont-vary', '1');
    }
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    $jsonResponse = json_encode([
        'success' => true,
        'taskId' => $taskId,
        'status' => 'pending'
    ]);
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Length: ' . strlen($jsonResponse));
    header('Connection: close');
    header('X-Accel-Buffering: no');
    echo $jsonResponse;
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    flush();
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    ob_start();
    executeVideoGeneration($taskId);
    ob_end_clean();
}

function executeVideoGeneration($taskId) {
    $lockHandle = tryLockTask($taskId);
    if (!$lockHandle) {
        return;
    }
    try {
        $status = getTaskStatus($taskId);
        if (!$status || $status['status'] !== 'pending') {
            unlockTask($lockHandle);
            return;
        }
        saveTaskStatus($taskId, 'processing', [], 'video', $lockHandle);
        $data = $status['data'];
        $modelId = $data['modelId'];
        $prompt = $data['prompt'];
        $imageUrl = $data['imageUrl'] ?? '';
        $aiSettings = loadAiConfig();
        $modelConfig = findAiModelConfig($aiSettings, $modelId);
        if (!$modelConfig) {
            saveTaskStatus($taskId, 'failed', ['error' => '模型配置不存在'], 'video', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $apiUrl = buildAiEndpoint($modelConfig['apiUrl'], 'video');
        $apiKey = $modelConfig['apiKey'];
        $modelName = getModelName($modelConfig);
        if (empty($apiUrl) || empty($apiKey)) {
            saveTaskStatus($taskId, 'failed', ['error' => '视频模型配置不完整'], 'video', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $requestBody = [
            'model' => $modelName,
            'prompt' => $prompt
        ];
        if (!empty($imageUrl)) {
            $requestBody['extra_body'] = ['image' => [$imageUrl]];
        }
        $ch = _initCurl($apiUrl, $apiKey, 120, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($requestBody));
        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($result === false) {
            saveTaskStatus($taskId, 'failed', ['error' => '视频任务创建失败：' . $error], 'video', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $decoded = json_decode($result, true);
        if ($httpCode < 200 || $httpCode >= 300 || (!$decoded && $result !== '')) {
            $errMsg = '视频任务创建失败';
            if ($decoded) {
                if (isset($decoded['error']['message'])) {
                    $errMsg .= '：' . $decoded['error']['message'];
                } elseif (isset($decoded['message'])) {
                    $errMsg .= '：' . $decoded['message'];
                } elseif (strlen($result) <= 300) {
                    $errMsg .= '：' . trim($result);
                }
            }
            saveTaskStatus($taskId, 'failed', ['error' => $errMsg, 'httpCode' => $httpCode], 'video', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        if (!empty($decoded['error']['message'])) {
            saveTaskStatus($taskId, 'failed', ['error' => '视频生成失败：' . $decoded['error']['message']], 'video', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        $internalTaskId = '';
        $videoId = '';
        if (isset($decoded['id'])) $internalTaskId = $decoded['id'];
        if (isset($decoded['task_id'])) $internalTaskId = $decoded['task_id'];
        if (isset($decoded['video_id'])) $videoId = $decoded['video_id'];
        if (isset($decoded['data']) && is_array($decoded['data'])) {
            if (empty($internalTaskId) && isset($decoded['data']['id'])) $internalTaskId = $decoded['data']['id'];
            if (empty($internalTaskId) && isset($decoded['data']['task_id'])) $internalTaskId = $decoded['data']['task_id'];
            if (empty($videoId) && isset($decoded['data']['video_id'])) $videoId = $decoded['data']['video_id'];
        }
        if (empty($videoId) && !empty($internalTaskId)) $videoId = $internalTaskId;
        if (empty($internalTaskId) && empty($videoId)) {
            saveTaskStatus($taskId, 'failed', ['error' => '视频任务创建成功但未返回任务 ID'], 'video', $lockHandle);
            unlockTask($lockHandle);
            return;
        }
        saveTaskStatus($taskId, 'polling', [
            'internalTaskId' => $internalTaskId,
            'videoId' => $videoId,
            'prompt' => $prompt,
            'imageUrl' => $imageUrl
        ], 'video', $lockHandle);
        pollVideoStatus($taskId, $internalTaskId, $videoId, $modelConfig, 120, $lockHandle);
    } catch (\Throwable $e) {
        saveTaskStatus($taskId, 'failed', ['error' => '视频生成异常：' . $e->getMessage()], 'video', $lockHandle);
    } finally {
        unlockTask($lockHandle);
    }
}

function pollVideoStatus($taskId, $internalTaskId, $videoId, $modelConfig, $maxAttempts = 120, $lockHandle = null) {
    $attempts = 0;
    $consecutiveErrors = 0;
    $maxConsecutiveErrors = 3;
    while ($attempts < $maxAttempts) {
        $attempts++;
        usleep(5000000);
        try {
            $baseHost = '';
            $apiUrl = $modelConfig['apiUrl'];
            if (preg_match('#^(https?://[^/]+)#i', $apiUrl, $m)) {
                $baseHost = $m[1];
            }
            $queryUrl = '';
            if (!empty($videoId) && !empty($baseHost)) {
                $queryUrl = $baseHost . '/agnesapi?video_id=' . urlencode($videoId);
            } elseif (!empty($internalTaskId)) {
                if (!empty($baseHost)) {
                    $queryUrl = $baseHost . '/v1/videos/' . urlencode($internalTaskId);
                } else {
                    $queryUrl = rtrim($apiUrl, '/') . '/' . urlencode($internalTaskId);
                }
            }
            if (empty($queryUrl)) {
                saveTaskStatus($taskId, 'failed', ['error' => '缺少任务 ID，无法查询'], 'video', $lockHandle);
                return;
            }
            $ch = _initCurl($queryUrl, $modelConfig['apiKey'], 30, false);
            $result = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $error = curl_error($ch);
            curl_close($ch);
            if ($result === false) {
                $consecutiveErrors++;
                if ($consecutiveErrors >= $maxConsecutiveErrors) {
                    saveTaskStatus($taskId, 'failed', ['error' => '视频状态查询失败：' . $error], 'video', $lockHandle);
                    return;
                }
                continue;
            }
            $consecutiveErrors = 0;
            $decoded = json_decode($result, true);
            if (!$decoded) {
                continue;
            }
            if ($httpCode !== 200) {
                continue;
            }
            $status = 'processing';
            if (isset($decoded['status'])) $status = $decoded['status'];
            elseif (isset($decoded['state'])) $status = $decoded['state'];
            $normStatus = 'processing';
            $lowerStatus = strtolower((string)$status);
            if (in_array($lowerStatus, ['completed', 'succeed', 'succeeded', 'success', 'done'], true)) {
                $normStatus = 'completed';
            } elseif (in_array($lowerStatus, ['failed', 'error', 'canceled', 'cancelled'], true)) {
                $normStatus = 'failed';
            }
            $progress = '';
            if (isset($decoded['progress'])) {
                $progress = is_numeric($decoded['progress']) ? strval($decoded['progress']) : '';
            } elseif (isset($decoded['data']['progress'])) {
                $progress = is_numeric($decoded['data']['progress']) ? strval($decoded['data']['progress']) : '';
            }
            saveTaskStatus($taskId, $normStatus === 'processing' ? 'processing' : $normStatus, 
                ['progress' => $progress, 'internalStatus' => $status], 'video', $lockHandle);
            if ($normStatus === 'completed') {
                $videoUrl = '';
                foreach (['video_url', 'url', 'video', 'download_url', 'output'] as $field) {
                    if (isset($decoded[$field]) && is_string($decoded[$field]) && $decoded[$field] !== '') {
                        $videoUrl = $decoded[$field];
                        break;
                    }
                }
                if (empty($videoUrl) && isset($decoded['results']) && is_array($decoded['results'])) {
                    foreach ($decoded['results'] as $r) {
                        if (is_string($r)) { $videoUrl = $r; break; }
                        if (is_array($r)) {
                            foreach (['url', 'video_url', 'video'] as $f) {
                                if (isset($r[$f])) { $videoUrl = $r[$f]; break 2; }
                            }
                        }
                    }
                }
                if (empty($videoUrl) && isset($decoded['data'])) {
                    if (is_string($decoded['data']) && $decoded['data'] !== '') {
                        $videoUrl = $decoded['data'];
                    } elseif (is_array($decoded['data'])) {
                        foreach (['url', 'video_url', 'video', 'download_url', 'output'] as $field) {
                            if (isset($decoded['data'][$field]) && is_string($decoded['data'][$field]) && $decoded['data'][$field] !== '') {
                                $videoUrl = $decoded['data'][$field];
                                break;
                            }
                        }
                    }
                }
                if (!empty($videoUrl)) {
                    try {
                        $imgDirReal = realpath(AI_OUTPUT_DIR);
                        if ($imgDirReal !== false) {
                            $filename = 'ai-video-' . time() . '-' . bin2hex(random_bytes(4)) . '.mp4';
                            $filepath = AI_OUTPUT_DIR . '/' . $filename;
                            $videoFp = @fopen($filepath, 'wb');
                            if ($videoFp !== false) {
                                $videoCh = curl_init($videoUrl);
                                curl_setopt($videoCh, CURLOPT_RETURNTRANSFER, false);
                                curl_setopt($videoCh, CURLOPT_FILE, $videoFp);
                                curl_setopt($videoCh, CURLOPT_CONNECTTIMEOUT, 30);
                                curl_setopt($videoCh, CURLOPT_TIMEOUT, 300);
                                curl_setopt($videoCh, CURLOPT_LOW_SPEED_LIMIT, 1024);
                                curl_setopt($videoCh, CURLOPT_LOW_SPEED_TIME, 60);
                                curl_setopt($videoCh, CURLOPT_SSL_VERIFYPEER, false);
                                curl_setopt($videoCh, CURLOPT_SSL_VERIFYHOST, 0);
                                $videoOk = curl_exec($videoCh);
                                $videoHttpCode = curl_getinfo($videoCh, CURLINFO_HTTP_CODE);
                                $videoErr = curl_error($videoCh);
                                curl_close($videoCh);
                                fclose($videoFp);
                                if ($videoOk !== false && $videoHttpCode === 200 && filesize($filepath) > 0) {
                                    saveTaskStatus($taskId, 'completed', [
                                        'videoUrl' => 'ai-output/' . $filename,
                                        'prompt' => $decoded['progress_data']['prompt'] ?? '',
                                        'progress' => 100
                                    ], 'video', $lockHandle);
                                    return;
                                }
                                @unlink($filepath);
                                error_log("视频下载失败: http={$videoHttpCode} err={$videoErr}");
                            }
                        }
                    } catch (\Throwable $e) {
                        error_log("视频保存异常: " . $e->getMessage());
                    }
                    saveTaskStatus($taskId, 'completed', [
                        'videoUrl' => $videoUrl,
                        'prompt' => $prompt,
                        'progress' => 100
                    ], 'video', $lockHandle);
                } else {
                    saveTaskStatus($taskId, 'failed', ['error' => '未返回视频 URL'], 'video', $lockHandle);
                }
                return;
            } elseif ($normStatus === 'failed') {
                $errorMsg = '视频生成失败';
                if (isset($decoded['error']['message'])) {
                    $errorMsg .= '：' . $decoded['error']['message'];
                } elseif (isset($decoded['message'])) {
                    $errorMsg .= '：' . $decoded['message'];
                }
                saveTaskStatus($taskId, 'failed', ['error' => $errorMsg], 'video', $lockHandle);
                return;
            }
        } catch (\Throwable $e) {
            $consecutiveErrors++;
            if ($consecutiveErrors >= $maxConsecutiveErrors) {
                saveTaskStatus($taskId, 'failed', ['error' => '视频轮询异常：' . $e->getMessage()], 'video', $lockHandle);
                return;
            }
        }
    }
    saveTaskStatus($taskId, 'failed', ['error' => '视频生成超时'], 'video', $lockHandle);
}

function handleAiVideoPoll($modelConfig, $taskId, $videoId) {
    $apiKey = $modelConfig['apiKey'];
    if (empty($apiKey)) {
        echo json_encode(['success' => false, 'error' => '视频模型配置不完整']);
        return;
    }
    if (!empty($taskId)) {
        $localStatus = getTaskStatus($taskId);
        if ($localStatus) {
            if ($localStatus['status'] === 'completed' || $localStatus['status'] === 'failed') {
                $localData = $localStatus['data'] ?? [];
                echo json_encode([
                    'success' => true,
                    'status' => $localStatus['status'],
                    'videoUrl' => $localData['videoUrl'] ?? '',
                    'progress' => $localData['progress'] ?? '',
                    'message' => $localData['error'] ?? ''
                ]);
                return;
            }
            if (empty($videoId) && isset($localStatus['data'])) {
                if (isset($localStatus['data']['videoId']) && $localStatus['data']['videoId'] !== '') {
                    $videoId = $localStatus['data']['videoId'];
                } elseif (isset($localStatus['data']['internalTaskId']) && $localStatus['data']['internalTaskId'] !== '') {
                    $videoId = $localStatus['data']['internalTaskId'];
                }
            }
        }
    }
    $baseHost = '';
    $apiUrl = $modelConfig['apiUrl'];
    if (preg_match('#^(https?://[^/]+)#i', $apiUrl, $m)) {
        $baseHost = $m[1];
    }
    $queryUrl = '';
    if (!empty($videoId) && !empty($baseHost)) {
        $queryUrl = $baseHost . '/agnesapi?video_id=' . urlencode($videoId);
    } elseif (!empty($videoId)) {
        if (!empty($baseHost)) {
            $queryUrl = $baseHost . '/v1/videos/' . urlencode($videoId);
        } else {
            $queryUrl = rtrim($apiUrl, '/') . '/' . urlencode($videoId);
        }
    }
    if (empty($queryUrl)) {
        if (!empty($taskId)) {
            $localStatus = getTaskStatus($taskId);
            if ($localStatus) {
                echo json_encode([
                    'success' => true,
                    'status' => $localStatus['status'],
                    'progress' => '',
                    'videoUrl' => ''
                ]);
                return;
            }
        }
        echo json_encode(['success' => false, 'error' => '缺少任务 ID，无法查询']);
        return;
    }
    $ch = _initCurl($queryUrl, $apiKey, 30, false);
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($result === false) {
        echo json_encode(['success' => false, 'error' => '视频状态查询失败：' . $error]);
        return;
    }
    $decoded = json_decode($result, true);
    if (!$decoded) {
        echo json_encode(['success' => false, 'error' => '视频状态响应解析失败', 'raw' => $result]);
        return;
    }
    if ($httpCode !== 200) {
        $errMsg = '视频状态查询失败';
        if (isset($decoded['error']['message'])) {
            $errMsg .= '：' . $decoded['error']['message'];
        } elseif (isset($decoded['message'])) {
            $errMsg .= '：' . $decoded['message'];
        }
        echo json_encode(['success' => false, 'error' => $errMsg, 'httpCode' => $httpCode]);
        return;
    }
    $status = 'processing';
    if (isset($decoded['status'])) $status = $decoded['status'];
    elseif (isset($decoded['state'])) $status = $decoded['state'];
    $normStatus = 'processing';
    $lowerStatus = strtolower((string)$status);
    if (in_array($lowerStatus, ['completed', 'succeed', 'succeeded', 'success', 'done'], true)) {
        $normStatus = 'completed';
    } elseif (in_array($lowerStatus, ['failed', 'error', 'canceled', 'cancelled'], true)) {
        $normStatus = 'failed';
    }
    $videoUrl = '';
    foreach (['video_url', 'url', 'video', 'download_url', 'output'] as $field) {
        if (isset($decoded[$field]) && is_string($decoded[$field]) && $decoded[$field] !== '') {
            $videoUrl = $decoded[$field];
            break;
        }
    }
    if (empty($videoUrl) && isset($decoded['results']) && is_array($decoded['results'])) {
        foreach ($decoded['results'] as $r) {
            if (is_string($r)) { $videoUrl = $r; break; }
            if (is_array($r)) {
                foreach (['url', 'video_url', 'video'] as $f) {
                    if (isset($r[$f])) { $videoUrl = $r[$f]; break 2; }
                }
            }
        }
    }
    if (empty($videoUrl) && isset($decoded['data'])) {
        if (is_string($decoded['data']) && $decoded['data'] !== '') {
            $videoUrl = $decoded['data'];
        } elseif (is_array($decoded['data'])) {
            foreach (['url', 'video_url', 'video', 'download_url', 'output'] as $field) {
                if (isset($decoded['data'][$field]) && is_string($decoded['data'][$field]) && $decoded['data'][$field] !== '') {
                    $videoUrl = $decoded['data'][$field];
                    break;
                }
            }
            if (empty($videoUrl) && isset($decoded['data']['results']) && is_array($decoded['data']['results'])) {
                foreach ($decoded['data']['results'] as $r) {
                    if (is_string($r) && $r !== '') { $videoUrl = $r; break; }
                    if (is_array($r)) {
                        foreach (['url', 'video_url', 'video', 'download_url'] as $f) {
                            if (isset($r[$f]) && is_string($r[$f]) && $r[$f] !== '') {
                                $videoUrl = $r[$f];
                                break 2;
                            }
                        }
                    }
                }
            }
        }
    }
    $progress = null;
    if (isset($decoded['progress']) && is_numeric($decoded['progress'])) {
        $progress = $decoded['progress'];
    } elseif (isset($decoded['data']['progress']) && is_numeric($decoded['data']['progress'])) {
        $progress = $decoded['data']['progress'];
    }
    echo json_encode([
        'success' => true,
        'status' => $normStatus,
        'rawStatus' => $status,
        'videoUrl' => $videoUrl,
        'progress' => $progress,
        'message' => isset($decoded['message']) ? $decoded['message'] : ''
    ]);
}
