/**
 * Elara 系统交互语音包批量生成器
 *
 * 功能：
 * 1. 根据预定义的交互意图批量生成语音。
 * 2. 调用 FastAPI TTS 接口生成 WAV。
 * 3. 将 WAV 保存到 FastAPI 服务能够访问的 outputs 目录。
 * 4. 调用 FastAPI LipSync 接口生成口型时间轴。
 * 5. 将最终资源保存到 Elara 前端 public/models/audio 目录。
 * 6. 每个意图独立生成 raw.txt、audio.wav、lipsync.json。
 * 7. TTS 和 LipSync 均支持失败重试。
 * 8. 已经完整生成的资源自动跳过。
 *
 * 最终目录结构：
 *
 * Elara/
 * └── public/
 *     └── models/
 *         └── audio/
 *             ├── request-received/
 *             │   ├── raw.txt
 *             │   ├── audio.wav
 *             │   └── lipsync.json
 *             ├── thinking-start/
 *             └── ...
 *
 * FastAPI 临时处理目录：
 *
 * ELARA-SRV/
 * └── outputs/
 *     └── interaction-voices/
 *         └── request-received/
 *             └── audio.wav
 *
 * 使用：
 *
 * node generate-voice-pack.js
 *
 * 指定前端资源输出目录：
 *
 * node generate-voice-pack.js ./public/models/audio
 *
 * 指定 FastAPI 服务：
 *
 * BASE_URL=http://localhost:8000 node generate-voice-pack.js
 */

const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * FastAPI 服务地址。
 *
 * 可以通过 BASE_URL 环境变量覆盖。
 */
const BASE_URL = process.env.BASE_URL || "http://localhost:8000";

/**
 * 当前脚本所在目录。
 *
 * 这里假设脚本位于 Elara 项目根目录。
 */
const PROJECT_ROOT = process.cwd();

/**
 * Elara 前端最终资源输出目录。
 *
 * 可以通过第一个命令行参数覆盖。
 */
const DEFAULT_OUTPUT_DIR = path.resolve(
    process.argv[2] ||
    "/Users/panzhiying/Desktop/github/Elara/public/models/audio",
);

/**
 * FastAPI 服务端用于处理 LipSync 的临时目录。
 *
 * 注意：
 * 这个目录必须属于 ELARA-SRV 项目。
 *
 * LipSync 接口收到的 path 会指向这里的文件。
 */
const SERVER_OUTPUT_DIR = path.resolve(
    process.env.SERVER_OUTPUT_DIR ||
    "/Users/panzhiying/Desktop/github/ELARA-SRV/outputs/interaction-voices",
);

/**
 * TTS 请求最大重试次数。
 */
const TTS_MAX_RETRIES = 3;

/**
 * LipSync 请求最大重试次数。
 */
const LIPSYNC_MAX_RETRIES = 3;

/**
 * 每次失败后的等待时间。
 *
 * 单位：毫秒。
 */
const RETRY_DELAY = 1500;

/**
 * 系统交互语音资源定义。
 *
 * intent：
 *   唯一的交互意图标识，同时作为输出目录名称。
 *
 * text：
 *   需要通过 TTS 生成的原始文本。
 *
 * description：
 *   当前语音的用途说明，仅用于日志和维护。
 */
const VOICE_PACKS = [
    {
        intent: "request-received",
        text: "嗯嗯～收到啦！",
        description: "收到用户请求",
    },
    {
        intent: "thinking-start",
        text: "唔……让我想想看哦～",
        description: "开始思考",
    },
    {
        intent: "waiting-short",
        text: "等我一下下哦～马上就好啦！",
        description: "短时间等待",
    },
    {
        intent: "waiting-long",
        text: "诶嘿……这个问题有点难呢，让我再想想～",
        description: "较长时间等待",
    },
    {
        intent: "waiting-timeout",
        text: "唔……还差一点点，再等我一下下嘛～",
        description: "超长时间等待",
    },
    {
        intent: "response-ready",
        text: "嘿嘿～我想好啦！",
        description: "AI 已经生成回答",
    },
    {
        intent: "network-error",
        text: "诶……网络好像偷偷跑掉了呢～",
        description: "网络错误",
    },
    {
        intent: "server-error",
        text: "呜……服务器好像闹小脾气了～",
        description: "服务器错误",
    },
    {
        intent: "llm-error",
        text: "唔……刚才好像没成功，再来一次试试看吧～",
        description: "AI 模型调用失败",
    },
    {
        intent: "tts-error",
        text: "诶……我的声音好像出了一点点问题～",
        description: "TTS 生成失败",
    },
    {
        intent: "lipsync-error",
        text: "唔……嘴巴好像没跟上呢～",
        description: "LipSync 处理失败",
    },
    {
        intent: "unknown-error",
        text: "呜……好像发生了一点小意外～",
        description: "未知错误",
    },
    {
        intent: "retry",
        text: "好呀～我们再试一次！",
        description: "重新请求",
    },
    {
        intent: "retrying",
        text: "嗯嗯～我再努力一下下！",
        description: "正在重试",
    },
    {
        intent: "cancelled",
        text: "好啦～那我们先停一下吧！",
        description: "用户取消请求",
    },
    {
        intent: "connection-restored",
        text: "呀～连接回来啦！",
        description: "网络连接恢复",
    },
];

/**
 * 创建目录。
 *
 * @param {string} directory 需要创建的目录。
 * @returns {Promise<void>} 目录创建完成。
 */
async function ensureDirectory(directory) {
    await fs.mkdir(directory, {
        recursive: true,
    });
}

/**
 * 判断文件是否存在。
 *
 * @param {string} filePath 文件路径。
 * @returns {Promise<boolean>} 文件存在返回 true，否则返回 false。
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * 等待指定时间。
 *
 * @param {number} milliseconds 等待时间，单位为毫秒。
 * @returns {Promise<void>} 等待完成。
 */
async function sleep(milliseconds) {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

/**
 * 检查 FastAPI 服务是否正常运行。
 *
 * @returns {Promise<void>} 服务正常时返回，否则抛出异常。
 */
async function checkServer() {
    console.log(`\n检查 FastAPI 服务：${BASE_URL}`);

    const response = await fetch(`${BASE_URL}/health`);

    if (!response.ok) {
        throw new Error(
            `FastAPI 服务不可用：HTTP ${response.status} ${response.statusText}`,
        );
    }

    console.log("✓ FastAPI 服务正常");
}

/**
 * 调用 TTS 接口生成 WAV。
 *
 * @param {string} text 需要转换成语音的文本。
 * @returns {Promise<Buffer>} WAV 音频二进制数据。
 */
async function generateTTS(text) {
    const response = await fetch(`${BASE_URL}/api/v1/tts`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
            `TTS 生成失败：HTTP ${response.status}\n${errorText}`,
        );
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("audio/wav")) {
        throw new Error(
            `TTS 返回格式错误，期望 audio/wav，实际为：${contentType}`,
        );
    }

    const arrayBuffer = await response.arrayBuffer();

    return Buffer.from(arrayBuffer);
}

/**
 * 带重试机制调用 TTS。
 *
 * @param {string} text 需要生成的文本。
 * @returns {Promise<Buffer>} TTS 生成的 WAV 数据。
 */
async function generateTTSWithRetry(text) {
    let lastError;

    for (let attempt = 1; attempt <= TTS_MAX_RETRIES; attempt += 1) {
        try {
            console.log(
                `→ 正在生成 TTS...（第 ${attempt}/${TTS_MAX_RETRIES} 次）`,
            );

            return await generateTTS(text);
        } catch (error) {
            lastError = error;

            console.error(
                `  TTS 第 ${attempt} 次失败：`,
                error instanceof Error ? error.message : error,
            );

            if (attempt < TTS_MAX_RETRIES) {
                console.log(`  ${RETRY_DELAY}ms 后重试...`);
                await sleep(RETRY_DELAY);
            }
        }
    }

    throw lastError;
}

/**
 * 调用 LipSync 接口分析 WAV。
 *
 * @param {string} audioPath FastAPI 服务端能够访问的 WAV 路径。
 * @returns {Promise<object>} LipSync 时间轴数据。
 */
async function generateLipSync(audioPath) {
    const response = await fetch(`${BASE_URL}/api/v1/lipsync/`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            path: audioPath,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
            `LipSync 生成失败：HTTP ${response.status}\n${errorText}`,
        );
    }

    const body = await response.json();

    if (body.code !== "SUCCESS") {
        throw new Error(
            `LipSync 返回失败：${body.message || "未知错误"}`,
        );
    }

    if (!body.data) {
        throw new Error("LipSync 返回数据为空");
    }

    return body.data;
}

/**
 * 带重试机制调用 LipSync。
 *
 * @param {string} audioPath FastAPI 服务端能够访问的音频路径。
 * @returns {Promise<object>} LipSync 时间轴数据。
 */
async function generateLipSyncWithRetry(audioPath) {
    let lastError;

    for (
        let attempt = 1;
        attempt <= LIPSYNC_MAX_RETRIES;
        attempt += 1
    ) {
        try {
            console.log(
                `→ 正在生成 LipSync：${audioPath}（第 ${attempt}/${LIPSYNC_MAX_RETRIES} 次）`,
            );

            return await generateLipSync(audioPath);
        } catch (error) {
            lastError = error;

            console.error(
                `  LipSync 第 ${attempt} 次失败：`,
                error instanceof Error ? error.message : error,
            );

            if (attempt < LIPSYNC_MAX_RETRIES) {
                console.log(`  ${RETRY_DELAY}ms 后重试...`);
                await sleep(RETRY_DELAY);
            }
        }
    }

    throw lastError;
}

/**
 * 将本地绝对路径转换成 FastAPI 服务端需要的路径。
 *
 * 这里不再使用 process.cwd() 判断。
 *
 * 因为：
 *
 * Elara：
 * /Users/.../github/Elara
 *
 * FastAPI：
 * /Users/.../github/ELARA-SRV
 *
 * 两个项目不是同一个目录。
 *
 * 因此 LipSync 必须直接收到 ELARA-SRV/outputs 下的路径。
 *
 * @param {string} serverAudioPath FastAPI outputs 目录下的音频路径。
 * @returns {string} FastAPI 使用的音频路径。
 */
function toServerAudioPath(serverAudioPath) {
    return path.relative(PROJECT_ROOT, serverAudioPath);
}

/**
 * 生成单个交互语音资源。
 *
 * @param {{
 *   intent: string,
 *   text: string,
 *   description: string
 * }} voice 语音资源定义。
 *
 * @param {string} outputDirectory 前端最终资源目录。
 *
 * @returns {Promise<void>} 生成完成。
 */
async function generateVoicePack(voice, outputDirectory) {
    /**
     * 前端最终资源目录。
     */
    const voiceDirectory = path.join(
        outputDirectory,
        voice.intent,
    );

    /**
     * FastAPI 临时处理目录。
     *
     * LipSync 只能读取服务端可以访问的文件，
     * 所以必须把 WAV 放到 ELARA-SRV/outputs 下。
     */
    const serverVoiceDirectory = path.join(
        SERVER_OUTPUT_DIR,
        voice.intent,
    );

    await ensureDirectory(voiceDirectory);
    await ensureDirectory(serverVoiceDirectory);

    /**
     * 前端最终文件。
     */
    const rawPath = path.join(
        voiceDirectory,
        "raw.txt",
    );

    const audioPath = path.join(
        voiceDirectory,
        "audio.wav",
    );

    const lipsyncPath = path.join(
        voiceDirectory,
        "lipsync.json",
    );

    /**
     * FastAPI 临时 WAV 文件。
     */
    const serverAudioPath = path.join(
        serverVoiceDirectory,
        "audio.wav",
    );

    console.log(`\n[${voice.intent}]`);
    console.log(`用途：${voice.description}`);
    console.log(`文本：${voice.text}`);

    /**
     * 如果三个最终资源都存在，
     * 说明该意图已经完整生成。
     */
    const existingFiles = await Promise.all(
        [rawPath, audioPath, lipsyncPath].map(fileExists),
    );

    if (existingFiles.every(Boolean)) {
        console.log("✓ 已存在，跳过");
        return "skipped";
    }

    /**
     * 保存原始文本。
     */
    await fs.writeFile(
        rawPath,
        voice.text,
        "utf8",
    );

    /**
     * 生成 TTS。
     */
    const audioBuffer = await generateTTSWithRetry(
        voice.text,
    );

    /**
     * WAV 同时保存两份：
     *
     * 1. ELARA-SRV/outputs：
     *    给 LipSync 使用。
     *
     * 2. Elara/public/models/audio：
     *    给前端 Avatar 使用。
     */
    await fs.writeFile(
        serverAudioPath,
        audioBuffer,
    );

    await fs.writeFile(
        audioPath,
        audioBuffer,
    );

    console.log("✓ audio.wav");

    /**
     * 将服务端绝对路径转换为 FastAPI 可使用的路径。
     */
    const lipSyncAudioPath =
        toServerAudioPath(serverAudioPath);

    /**
     * 生成 LipSync。
     */
    const lipSync =
        await generateLipSyncWithRetry(
            lipSyncAudioPath,
        );

    /**
     * 保存 LipSync 数据到前端资源目录。
     */
    await fs.writeFile(
        lipsyncPath,
        JSON.stringify(
            lipSync,
            null,
            2,
        ),
        "utf8",
    );

    console.log("✓ lipsync.json");
    console.log("✓ 完成");

    return "success";
}

/**
 * 批量生成所有交互语音。
 *
 * @returns {Promise<void>} 所有任务执行完成。
 */
async function main() {
    console.log("========================================");
    console.log(
        " Elara Interaction Voice Pack Generator",
    );
    console.log("========================================");

    console.log(`FastAPI：${BASE_URL}`);
    console.log(
        `前端输出：${DEFAULT_OUTPUT_DIR}`,
    );
    console.log(
        `服务端临时目录：${SERVER_OUTPUT_DIR}`,
    );
    console.log(
        `资源数量：${VOICE_PACKS.length}`,
    );

    /**
     * 检查 FastAPI。
     */
    await checkServer();

    /**
     * 创建两个目录。
     */
    await ensureDirectory(
        DEFAULT_OUTPUT_DIR,
    );

    await ensureDirectory(
        SERVER_OUTPUT_DIR,
    );

    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    /**
     * 有意使用串行处理。
     *
     * 因为 Qwen3-TTS 属于本地模型推理，
     * 同时请求多个 TTS 很容易造成：
     *
     * - 内存压力
     * - MPS 压力
     * - fetch failed
     * - 推理任务互相阻塞
     *
     * 所以语音包生成阶段不要并发。
     */
    for (const voice of VOICE_PACKS) {
        try {
            const result =
                await generateVoicePack(
                    voice,
                    DEFAULT_OUTPUT_DIR,
                );

            if (result === "success") {
                successCount += 1;
            } else if (result === "skipped") {
                skippedCount += 1;
            }
        } catch (error) {
            failedCount += 1;

            console.error(
                `✗ ${voice.intent} 生成失败：`,
                error instanceof Error
                    ? error.message
                    : error,
            );
        }
    }

    console.log("\n========================================");
    console.log("生成完成");
    console.log("========================================");
    console.log(`成功：${successCount}`);
    console.log(`跳过：${skippedCount}`);
    console.log(`失败：${failedCount}`);
    console.log(
        `输出：${DEFAULT_OUTPUT_DIR}`,
    );

    if (failedCount > 0) {
        process.exitCode = 1;
    }
}

/**
 * 启动批量生成任务。
 */
main().catch((error) => {
    console.error(
        "\n生成器执行失败：",
    );

    console.error(
        error instanceof Error
            ? error.message
            : error,
    );

    process.exitCode = 1;
});