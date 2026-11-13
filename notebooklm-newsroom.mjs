/**
 * ============================================================================
 * TÒA SOẠN BÁO CHÍ & BẢN TIN AUDIO TỰ ĐỘNG (NOTEBOOKLM x ANTIGRAVITY PIPELINE)
 * ============================================================================
 * Quy trình tự động khép kín mỗi sáng (06:30 AM):
 *   0. Tự động quét RSS trực tiếp từ VnExpress, Tuổi Trẻ, Dân Trí, VietnamNet, Thanh Niên
 *      để cập nhật live-fresh-articles.json (nếu có mạng).
 *   1. Chuẩn bị Hồ sơ 15 bài báo tiêu điểm & tin nóng đa chuyên mục.
 *   2. Tự động khởi tạo Sổ tay NotebookLM mới (create_notebook) theo ngày.
 *   3. Bơm hồ sơ tin tức đa nguồn vào NotebookLM (add_source).
 *   4. Đặt câu hỏi biên tập tổng hợp đa chiều kèm trích dẫn gốc (ask_question + citations).
 *   5. Kích hoạt tạo Podcast Audio Overview (generate_audio) và xuất dữ liệu ra
 *      notebooklm-digest.json & notebooklm-digest.js cho Cổng Tin Tức Web (index.html).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MCP_DIST = "D:\\Anti\\notebooklm-mcp\\dist";

const RSS_FEEDS = [
  { name: "VnExpress", url: "https://vnexpress.net/rss/tin-moi-nhat.rss" },
  { name: "VnExpress", url: "https://vnexpress.net/rss/thoi-su.rss" },
  { name: "VnExpress", url: "https://vnexpress.net/rss/so-hoa.rss" },
  { name: "Tuổi Trẻ", url: "https://tuoitre.vn/rss/tin-moi-nhat.rss" },
  { name: "Tuổi Trẻ", url: "https://tuoitre.vn/rss/thoi-su.rss" },
  { name: "Tuổi Trẻ", url: "https://tuoitre.vn/rss/cong-nghe.rss" },
  { name: "Dân Trí", url: "https://dantri.com.vn/rss/tin-moi-nhat.rss" },
  { name: "Dân Trí", url: "https://dantri.com.vn/rss/thoi-su.rss" },
  { name: "Dân Trí", url: "https://dantri.com.vn/rss/cong-nghe.rss" },
  { name: "Thanh Niên", url: "https://thanhnien.vn/rss/home.rss" },
  { name: "Thanh Niên", url: "https://thanhnien.vn/rss/thoi-su.rss" },
  { name: "Thanh Niên", url: "https://thanhnien.vn/rss/cong-nghe.rss" },
];

const CATEGORY_RULES = [
  {
    category: "Thiên tai",
    keywords: ["bão", "áp thấp", "lũ quét", "sạt lở", "triều cường", "động đất", "hạn hán", "ngập lụt", "mưa lũ", "thiên tai", "xả lũ"],
  },
  {
    category: "Thời tiết cực đoan",
    keywords: ["nắng nóng", "rét đậm", "rét hại", "mưa đá", "lốc xoáy", "gió giật", "sương muối", "tia uv", "băng giá", "thời tiết"],
  },
  {
    category: "Tai nạn",
    keywords: ["tai nạn", "cháy nổ", "hỏa hoạn", "cứu hộ", "cứu nạn", "va chạm", "tông liên hoàn", "sập", "đuối nước"],
  },
  {
    category: "Công nghệ AI",
    keywords: ["ai", "trí tuệ nhân tạo", "chatgpt", "openai", "gemini", "deepmind", "llm", "chip bán dẫn", "grok", "robot"],
  },
  {
    category: "Thủ thuật IT",
    keywords: ["bảo mật", "an toàn thông tin", "tin tặc", "hacker", "mã độc", "lỗ hổng", "phần mềm", "windows", "mạng"],
  },
  {
    category: "Chính trị",
    keywords: ["quốc hội", "chính phủ", "thủ tướng", "bộ trưởng", "tổng bí thư", "chủ tịch nước", "nghị quyết", "đối tác chiến lược", "ngoại giao", "chất vấn"],
  },
];

function classifyArticle(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return rule.category;
    }
  }
  return "Chính trị";
}

function cleanXmlText(str) {
  if (!str) return "";
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPubDate(pubDateStr) {
  const d = pubDateStr ? new Date(pubDateStr) : new Date();
  const valid = isNaN(d.getTime()) ? new Date() : d;
  const day = String(valid.getDate()).padStart(2, "0");
  const month = String(valid.getMonth() + 1).padStart(2, "0");
  const year = valid.getFullYear();
  const h = String(valid.getHours()).padStart(2, "0");
  const m = String(valid.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${h}:${m}`;
}

async function fetchLiveRssArticles() {
  console.log("🌐 [Bước 0/5] Đang quét các luồng RSS báo chí chính thống mới nhất...");
  const collected = [];
  const seenLinks = new Set();

  for (const feed of RSS_FEEDS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(feed.url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const xml = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match;
      let countPerFeed = 0;
      while ((match = itemRegex.exec(xml)) !== null && countPerFeed < 8) {
        const block = match[1];
        const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
        const rawDesc = (block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || "";
        const rawLink = (block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "";
        const rawPub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "";

        const imgMatch =
          rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i) ||
          block.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
        const thumbnail = imgMatch ? imgMatch[1] : "";

        const title = cleanXmlText(rawTitle);
        const tldr = cleanXmlText(rawDesc);
        const link = cleanXmlText(rawLink);

        if (!title || !link || seenLinks.has(link) || tldr.length < 30) continue;
        seenLinks.add(link);
        countPerFeed++;

        const category = classifyArticle(title, tldr);
        collected.push({
          stt: collected.length + 1,
          publishedAt: formatPubDate(cleanXmlText(rawPub)),
          category,
          title,
          tldr,
          source: feed.name,
          link,
          thumbnail:
            thumbnail ||
            "https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1200&q=80",
          prominence: collected.length === 0 ? "Tin tiêu điểm" : collected.length < 12 ? "Tin nóng" : "Tin thường",
        });
      }
    } catch {
      // Bỏ qua feed lỗi mạng
    }
  }

  if (collected.length >= 10) {
    const outPath = path.join(__dirname, "live-fresh-articles.json");
    fs.writeFileSync(outPath, JSON.stringify(collected, null, 2), "utf-8");
    console.log(`✅ Đã cập nhật ${collected.length} bài báo mới nhất từ RSS vào live-fresh-articles.json`);
    return collected;
  }

  console.log("ℹ️ Sử dụng dữ liệu đệm từ live-fresh-articles.json...");
  return JSON.parse(fs.readFileSync(path.join(__dirname, "live-fresh-articles.json"), "utf-8"));
}

async function loadMcpModule(relPath) {
  const fullPath = path.join(MCP_DIST, relPath);
  return import(pathToFileURL(fullPath).href);
}

function getTodayDateString() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const y = now.getFullYear();
  return `${d}/${m}/${y}`;
}

function buildNewsDossier(articles, dateStr) {
  const selected = articles.slice(0, 15);
  const lines = [
    `HỒ SƠ TIN TỨC TỔNG HỢP TÒA SOẠN ĐIỆN TỬ 24H - NGÀY ${dateStr}`,
    `Tổng số nguồn bài báo được xác thực: ${selected.length} bài báo chính thống.`,
    `====================================================================`,
    "",
  ];

  selected.forEach((art, idx) => {
    const cleanLink = String(art.link || "")
      .replace("<![CDATA[", "")
      .replace("]]>", "")
      .trim();
    lines.push(
      `[BÀI BÁO #${idx + 1}]`,
      `- Chuyên mục: ${art.category}`,
      `- Mức độ: ${art.prominence || "Tin nóng"}`,
      `- Tiêu đề: ${art.title}`,
      `- Nguồn báo: ${art.source} | Thời gian: ${art.publishedAt}`,
      `- Nội dung tóm tắt xác thực: ${art.tldr}`,
      `- Đường dẫn gốc: ${cleanLink}`,
      `--------------------------------------------------------------------`,
      ""
    );
  });

  return {
    dossierText: lines.join("\n"),
    selectedArticles: selected,
  };
}

async function runNewsroomPipeline() {
  console.log("==================================================================");
  console.log(" 🚀 KHỞI ĐỘNG DÂY CHUYỀN TÒA SOẠN AI (NOTEBOOKLM x ANTIGRAVITY)");
  console.log("==================================================================");

  const { AuthManager } = await loadMcpModule("auth/auth-manager.js");
  const { SessionManager } = await loadMcpModule("session/session-manager.js");
  const { NotebookLibrary } = await loadMcpModule("library/notebook-library.js");
  const { ToolHandlers } = await loadMcpModule("tools/handlers.js");

  const authManager = new AuthManager();
  const sessionManager = new SessionManager(authManager);
  const library = new NotebookLibrary();
  const handlers = new ToolHandlers(sessionManager, authManager, library);

  try {
    // 0 & 1. Quét RSS trực tiếp và chuẩn bị hồ sơ 15 bài báo
    const rawArticles = await fetchLiveRssArticles();
    const dateStr = getTodayDateString();
    const notebookTitle = `Tòa Soạn AI - Bản Tin ${dateStr}`;

    const { dossierText, selectedArticles } = buildNewsDossier(rawArticles, dateStr);
    console.log(`📰 [Bước 1/5] Đã chuẩn bị Hồ sơ Tin tức gồm ${selectedArticles.length} bài báo tiêu điểm.`);

    // 2. Kiểm tra hoặc tạo mới Sổ tay NotebookLM trong ngày
    let listRes = await handlers.handleListNotebooks();
    let existing = listRes.data?.notebooks?.find((n) => n.name === notebookTitle);
    let notebookEntry = existing;

    if (!notebookEntry) {
      console.log(`📒 [Bước 2/5] Đang tạo Sổ tay mới trên Google NotebookLM: "${notebookTitle}"...`);
      const createRes = await handlers.handleCreateNotebook({
        name: notebookTitle,
        description: `Bản tin tổng hợp đa nguồn tự động ngày ${dateStr} từ Cổng Tin Tức Điện Tử 24H`,
        topics: ["Thời sự Chính trị", "Công nghệ AI", "Thiên tai & Thời tiết", "An toàn Giao thông"],
        use_cases: ["Tổng hợp bản tin hàng ngày", "Phân tích xu hướng đa nguồn", "Podcast thời sự"],
        set_active: true,
      });

      if (!createRes.success || !createRes.data?.notebook) {
        throw new Error(`Không thể tạo sổ tay: ${createRes.error}`);
      }
      notebookEntry = createRes.data.notebook;
      console.log(`✅ Đã tạo sổ tay thành công: ${notebookEntry.id} (${notebookEntry.url})`);

      // 3. Bơm Hồ sơ Tin tức vào Sổ tay vừa tạo
      console.log(`📥 [Bước 3/5] Đang nạp Hồ sơ ${selectedArticles.length} bài báo vào NotebookLM...`);
      const addSourceRes = await handlers.handleAddSource({
        notebook_id: notebookEntry.id,
        type: "text",
        title: `Hồ sơ Tin tức Báo chí Chính thống (${dateStr})`,
        content: dossierText,
      });

      if (!addSourceRes.success || !addSourceRes.data?.result?.success) {
        console.warn(`⚠️ Cảnh báo khi nạp nguồn: ${addSourceRes.error || addSourceRes.data?.result?.message}`);
      } else {
        console.log(
          `✅ Đã nạp nguồn thành công vào NotebookLM (Số nguồn: ${addSourceRes.data.result.sourceCountBefore} -> ${addSourceRes.data.result.sourceCountAfter})`
        );
      }
    } else {
      console.log(`📌 [Bước 2/5] Sử dụng Sổ tay trong ngày đã có sẵn: ${notebookEntry.id} (${notebookEntry.url})`);
    }

    // 4. Đặt câu hỏi biên tập Bản tin Tổng hợp Đa chiều có Trích dẫn (Citations)
    console.log(`🧠 [Bước 4/5] Đang yêu cầu NotebookLM biên tập Bản tin Phân tích Đa chiều & bóc tách Trích dẫn...`);
    const editorialPrompt =
      "Hãy đóng vai Tổng Biên Tập Tòa Soạn Báo Điện Tử 24H. Dựa hoàn toàn vào hồ sơ các bài báo đã cung cấp, hãy lập 'BẢN TIN TỔNG HỢP & PHÂN TÍCH ĐA CHIỀU' bằng tiếng Việt theo 4 mục rõ ràng: " +
      "1. TIÊU ĐIỂM CHÍNH TRỊ & ĐIỀU HÀNH VĨ MÔ (nêu rõ sự kiện, nhân vật, con số cụ thể). " +
      "2. CHUYỂN ĐỘNG CÔNG NGHỆ AI & THẾ GIỚI. " +
      "3. CẢNH BÁO THIÊN TAI, THỜI TIẾT & AN TOÀN XÃ HỘI. " +
      "4. NHẬN ĐỊNH TỔNG QUAN TRONG NGÀY (2-3 câu đúc kết xu hướng chính). " +
      "Yêu cầu: Giọng văn báo chí chính luận, súc tích, giữ nguyên các mốc số liệu và gắn trích dẫn nguồn đầy đủ.";

    const askRes = await handlers.handleAskQuestion({
      notebook_id: notebookEntry.id,
      question: editorialPrompt,
      citation_format: "json",
    });

    if (!askRes.success || !askRes.data) {
      throw new Error(`Truy vấn NotebookLM thất bại: ${askRes.error}`);
    }

    let rawAnswer = askRes.data.answer || "";
    rawAnswer = rawAnswer
      .replace(/^\[(?:NOTEBOOKLM|AI)-GENERATED[\s\S]*?\]\s*/i, "")
      .replace(/\n*\uD83C\uDF99[\s\S]*$/i, "")
      .trim();

    const citations = askRes.data.citations?.citations || [];
    console.log(`✅ Đã nhận Bản tin Tổng hợp (${rawAnswer.length} ký tự, ${citations.length} trích dẫn xác thực).`);

    // 5. Kích hoạt tạo Audio Overview (chế độ bất đồng bộ không chặn luồng)
    console.log(`🎙️ [Bước 5/5] Đang kích hoạt phòng thu NotebookLM Audio Overview...`);
    let audioStatus = "not_started";
    let audioMessage = "";
    try {
      const audioRes = await handlers.handleGenerateAudio({
        notebook_id: notebookEntry.id,
        wait_for_completion: false,
      });
      if (audioRes.success && audioRes.data?.result) {
        audioStatus = audioRes.data.result.status;
        audioMessage = audioRes.data.result.message || "Đang xử lý tại phòng thu NotebookLM Studio";
        console.log(`✅ Trạng thái Audio Overview: ${audioStatus}`);
      }
    } catch (audioErr) {
      console.warn(`⚠️ Không thể kích hoạt Audio Overview lúc này:`, audioErr);
    }

    const digestPayload = {
      generatedAt: new Date().toISOString(),
      displayDate: dateStr,
      notebook: {
        id: notebookEntry.id,
        name: notebookEntry.name,
        url: notebookEntry.url,
        sourceCount: selectedArticles.length,
      },
      briefingMarkdown: rawAnswer,
      citations: citations,
      sourceArticles: selectedArticles.map((a, i) => ({
        index: i + 1,
        title: a.title,
        source: a.source,
        category: a.category,
        publishedAt: a.publishedAt,
        link: String(a.link || "").replace("<![CDATA[", "").replace("]]>", "").trim(),
      })),
      audioOverview: {
        status: audioStatus,
        message: audioMessage,
        localFile: null,
      },
    };

    const jsonOutPath = path.join(__dirname, "notebooklm-digest.json");
    const jsOutPath = path.join(__dirname, "notebooklm-digest.js");

    fs.writeFileSync(jsonOutPath, JSON.stringify(digestPayload, null, 2), "utf-8");
    fs.writeFileSync(
      jsOutPath,
      `// Tự động sinh bởi NotebookLM x Antigravity Newsroom Pipeline\nwindow.NOTEBOOKLM_DAILY_DIGEST = ${JSON.stringify(digestPayload, null, 2)};\n`,
      "utf-8"
    );

    console.log("==================================================================");
    console.log(" 🎉 HOÀN TẤT XUẤT BẢN BẢN TIN AI NOTEBOOKLM!");
    console.log(` 📄 File JSON: ${jsonOutPath}`);
    console.log(` 📄 File JS  : ${jsOutPath}`);
    console.log(` 🔗 Sổ tay   : ${notebookEntry.url}`);
    console.log("==================================================================");
  } finally {
    await sessionManager.closeAllSessions();
    process.exit(0);
  }
}

runNewsroomPipeline().catch((err) => {
  console.error("❌ Lỗi thực thi Newsroom Pipeline:", err);
  process.exit(1);
});
