export default {
  async fetch(request) {
    const url = new URL(request.url);
    const sourceURL = url.searchParams.get("url");
    // maxDelay is the timeout for fetching each individual URL, default 1000ms
    const maxDelay = parseInt(url.searchParams.get("max") || "1000");
    // protoFilter allows filtering by protocol, e.g., "?proto=http,https"
    const protoFilter = (url.searchParams.get("proto") || "").split(",").filter(Boolean);
    // keyword allows filtering by a keyword in the URL (decoded)
    const keyword = url.searchParams.get("keyword") || "";
    // addLatency appends latency to the fragment identifier if present
    const addLatency = url.searchParams.get("add_latency") === "true";

    if (!sourceURL) {
      return new Response("Missing ?url=...", { status: 400 });
    }

    let rawText = "";
    try {
      // Fetch the list of URLs from the source
      const resp = await fetch(sourceURL);
      if (!resp.ok) {
         return new Response(`Failed to fetch source: Status ${resp.status}`, { status: resp.status });
      }
      rawText = await resp.text();
    } catch (e) {
      return new Response("Failed to fetch source: " + e.message, { status: 500 });
    }

    // Split into lines, trim whitespace, and remove empty lines
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    // Process each line (URL)
    for (const line of lines) {
      try {
        const lowerLine = line.toLowerCase();

        // Apply protocol filter
        if (protoFilter.length && !protoFilter.some(p => lowerLine.startsWith(p + "://"))) {
           // console.log(`Skipping line due to proto filter: ${line}`); // Optional logging
           continue;
        }

        // Apply keyword filter (check against decoded line)
        if (keyword && !decodeURIComponent(line).includes(keyword)) {
           // console.log(`Skipping line due to keyword filter: ${line}`); // Optional logging
           continue;
        }

        // Parse the URL from the line
        const parsed = new URL(line);
        const host = parsed.hostname;
        // Determine the protocol and port for testing based on the parsed URL
        const protocol = parsed.protocol; // e.g., "http:", "https:"
        // Use the original port if present, otherwise use the default for the protocol
        const port = parsed.port || (protocol === 'https:' ? '443' : '80');

        // Construct the URL for the reachability test (HEAD request)
        const testURL = `${protocol}//${host}:${port}`;

        // Setup timeout for the fetch request
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), maxDelay);

        const start = Date.now();
        let res = null;
        try {
           // Perform a HEAD request to test reachability and get latency
           res = await fetch(testURL, {
             method: "HEAD",
             signal: controller.signal,
             // Setting redirect: 'manual' or 'follow' might be considered
             // 'manual' means 3xx won't throw error but return 3xx status
             // 'follow' means 3xx will follow redirects (up to a limit)
             // Default is 'follow'. 'HEAD' with 'follow' might behave differently depending on target server.
             // For a simple reachability/latency check, default 'follow' is usually fine,
             // but 'HEAD' may not follow GET redirects. Let's keep default for simplicity.
           });
        } catch (e) {
            // Catch fetch errors like network issues, timeouts (due to abort signal)
            // console.error(`Workspace error for ${testURL}: ${e.message}`); // Optional logging
            res = null; // Ensure res is null on error
        } finally {
           // Clear the timeout regardless of fetch success or failure
           clearTimeout(timeout);
        }

        const delay = Date.now() - start;

        // Check if the response status indicates success/reachability (2xx, 3xx, 4xx)
        if (res && res.status >= 200 && res.status < 500) {
          // If addLatency is true and the line has a fragment (#)
          if (addLatency && line.includes("#")) {
            const [urlPart, nameEncoded] = line.split("#", 2); // Split only on the first #
            try {
               // Decode the existing fragment name, add latency, re-encode, and reconstruct
               const nameDecoded = decodeURIComponent(nameEncoded);
               const newNameEncoded = encodeURIComponent(`${nameDecoded}|${delay}ms`);
               results.push(`${urlPart}#${newNameEncoded}`);
            } catch (e) {
               // Handle potential decoding errors in the fragment
               // console.error(`Failed to process fragment for ${line}: ${e.message}`); // Optional logging
               results.push(line); // Push original line if fragment processing fails
            }
          } else {
            // Otherwise, just push the original line
            results.push(line);
          }
        } else {
             // console.log(`Skipping line due to fetch failure or status ${res ? res.status : 'none'}: ${line}`); // Optional logging
        }
      } catch (e) {
        // Catch any other errors during processing of this specific line (e.g., invalid URL parsing)
        // console.error(`Error processing line "${line}": ${e.message}`); // Optional logging
        // Ignore this line and continue
      }
    }

    // Return the filtered and potentially modified list of URLs
    return new Response(results.join('\n'), {
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
}

