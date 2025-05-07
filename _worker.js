export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 优先使用环境变量，其次使用 URL 参数
    const sourceURL = env.URL || url.searchParams.get("url");
    const maxDelay = parseInt(env.MAX || url.searchParams.get("max") || "1000");
    const protoFilter = (env.PROTO || url.searchParams.get("proto") || "").split(",").filter(Boolean);
    const keyword = env.KEYWORD || url.searchParams.get("keyword") || "";
    const addLatency = (env.ADD_LATENCY || url.searchParams.get("add_latency")) === "true";

    if (!sourceURL) {
      return new Response("Missing 'url' from env or ?url=...", { status: 400 });
    }

    let rawText = "";
    try {
      const resp = await fetch(sourceURL);
      if (!resp.ok) {
        return new Response(`Failed to fetch source: Status ${resp.status}`, { status: resp.status });
      }
      rawText = await resp.text();
    } catch (e) {
      return new Response("Failed to fetch source: " + e.message, { status: 500 });
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    for (const line of lines) {
      try {
        const lowerLine = line.toLowerCase();

        if (protoFilter.length && !protoFilter.some(p => lowerLine.startsWith(p + "://"))) {
          continue;
        }

        if (keyword && !decodeURIComponent(line).includes(keyword)) {
          continue;
        }

        const parsed = new URL(line);
        const host = parsed.hostname;
        const protocol = parsed.protocol;
        const port = parsed.port || (protocol === 'https:' ? '443' : '80');
        const testURL = `${protocol}//${host}:${port}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), maxDelay);

        const start = Date.now();
        let res = null;
        try {
          res = await fetch(testURL, {
            method: "HEAD",
            signal: controller.signal,
          });
        } catch (e) {
          res = null;
        } finally {
          clearTimeout(timeout);
        }

        const delay = Date.now() - start;

        if (res && res.status >= 200 && res.status < 500) {
          if (addLatency && line.includes("#")) {
            const [urlPart, nameEncoded] = line.split("#", 2);
            try {
              const nameDecoded = decodeURIComponent(nameEncoded);
              const newNameEncoded = encodeURIComponent(`${nameDecoded}|${delay}ms`);
              results.push(`${urlPart}#${newNameEncoded}`);
            } catch (e) {
              results.push(line);
            }
          } else {
            results.push(line);
          }
        }
      } catch (e) {
        // 忽略解析失败的行
      }
    }

    return new Response(results.join('\n'), {
      headers: { "Content-Type": "text/plain" }
    });
  }
}
