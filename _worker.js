export default {
  async fetch(request) {
    const url = new URL(request.url);
    const sourceURL = url.searchParams.get("url");
    const maxDelay = parseInt(url.searchParams.get("max") || "1000");
    const protoFilter = (url.searchParams.get("proto") || "").split(",").filter(Boolean);
    const keyword = url.searchParams.get("keyword") || "";
    const addLatency = url.searchParams.get("add_latency") === "true";

    if (!sourceURL) {
      return new Response("Missing ?url=...", { status: 400 });
    }

    let rawText = "";
    try {
      const resp = await fetch(sourceURL);
      rawText = await resp.text();
    } catch (e) {
      return new Response("Failed to fetch source: " + e.message, { status: 500 });
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    for (const line of lines) {
      try {
        const lower = line.toLowerCase();
        if (protoFilter.length && !protoFilter.some(p => lower.startsWith(p + "://"))) continue;
        if (keyword && !decodeURIComponent(line).includes(keyword)) continue;

        const parsed = new URL(line);
        const host = parsed.hostname;
        const port = parseInt(parsed.port || "443");

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), maxDelay);

        const start = Date.now();
        const res = await fetch(`https://${host}:${port}`, {
          method: "HEAD",
          signal: controller.signal
        }).catch(() => null);
        const delay = Date.now() - start;

        clearTimeout(timeout);

        if (res && res.status >= 200 && res.status < 500) {
          if (addLatency && line.includes("#")) {
            const [urlPart, name] = line.split("#");
            const newName = ${decodeURIComponent(name)}|${delay}ms;
            results.push(`${urlPart}#${encodeURIComponent(newName)}`);
          } else {
            results.push(line);
          }
        }
      } catch (_) {
        // ignore error
      }
    }

    return new Response(results.join('\n'), {
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
}
