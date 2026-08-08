#!/usr/bin/env node
/**
 * 独立 LLM 调用脚本 —— 通过子进程运行，绕过 Next.js Turbopack 运行时的 fetch 阻塞问题。
 *
 * 用法: node scripts/llm-call.mjs
 * 输入: stdin JSON { baseURL, apiKey, model, system, user, maxTokens, timeout }
 * 输出: stdout JSON { ok: true, content: "..." } 或 { ok: false, error: "..." }
 */

const chunks = [];
process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const { baseURL, apiKey, model, format = 'openai', options = {}, system, user, maxTokens = 4096, timeout = 150000, jsonMode = false } = input;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const startTime = Date.now();
    const base = String(baseURL).replace(/\/+$/, '');
    const endpoint = (path) => /\/v1$/i.test(base) && path.startsWith('/v1/') ? base + path.slice(3) : base + path;
    const url = format === 'gemini'
      ? `${base}/models/${encodeURIComponent(model)}:generateContent`
      : format === 'anthropic'
        ? endpoint('/v1/messages')
        : format === 'openai-responses' ? endpoint('/v1/responses') : endpoint('/v1/chat/completions');
    const headers = format === 'gemini'
      ? { 'Authorization': `Bearer ${apiKey}`, 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
      : format === 'anthropic'
        ? { 'Authorization': `Bearer ${apiKey}`, 'x-api-key': apiKey, 'anthropic-version': options.anthropicVersion || '2023-06-01', 'Content-Type': 'application/json' }
        : { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const stream = format === 'openai' && options.stream !== false;
    const supportedOptions = Object.fromEntries(
      ['reasoning_effort', 'verbosity', 'service_tier', 'top_p', 'seed']
        .filter((key) => options[key] !== undefined)
        .map((key) => [key, options[key]]),
    );
    const body = format === 'gemini'
      ? {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens },
        }
      : format === 'anthropic'
        ? { model, system, messages: [{ role: 'user', content: user }], max_tokens: maxTokens }
        : format === 'openai-responses'
          ? { model, instructions: system, input: user, max_output_tokens: maxTokens }
        : {
            model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            max_tokens: maxTokens,
            stream,
            ...supportedOptions,
            ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          };
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!resp.ok) {
      const errBody = await resp.text();
      clearTimeout(timer);
      process.stdout.write(JSON.stringify({ ok: false, error: `HTTP ${resp.status}: ${errBody.slice(0, 500)}`, elapsed }));
      process.exit(0);
    }

    if (stream && /text\/event-stream/i.test(resp.headers.get('content-type') || '')) {
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('LLM 流式响应没有响应体');
      const decoder = new TextDecoder();
      let buffer = '';
      let content = '';
      let finishReason = '';
      let usage = null;
      let streamError = '';
      const consumeLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const raw = trimmed.slice(5).trim();
        if (!raw || raw === '[DONE]') return;
        try {
          const chunk = JSON.parse(raw);
          if (chunk?.error) {
            streamError = chunk.error.message || JSON.stringify(chunk.error);
            return;
          }
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') content += delta;
          else if (Array.isArray(delta)) content += delta.map((part) => part?.text || part?.content || '').join('');
          finishReason = chunk?.choices?.[0]?.finish_reason || finishReason;
          usage = chunk?.usage || usage;
        } catch {
          // Ignore SSE keepalive and provider-specific metadata frames.
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = done ? '' : lines.pop() || '';
        for (const line of lines) consumeLine(line);
        if (done) break;
      }
      if (buffer) consumeLine(buffer);
      clearTimeout(timer);
      if (streamError) {
        process.stdout.write(JSON.stringify({ ok: false, error: streamError, elapsed: ((Date.now() - startTime) / 1000).toFixed(1) }));
      } else if (!content) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'LLM 流式响应为空', elapsed: ((Date.now() - startTime) / 1000).toFixed(1) }));
      } else {
        process.stdout.write(JSON.stringify({ ok: true, content, elapsed: ((Date.now() - startTime) / 1000).toFixed(1), finishReason, usage }));
      }
      process.exit(0);
    }

    const data = await resp.json();
    clearTimeout(timer);
    const content = format === 'gemini'
      ? (data?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || '').join('')
      : format === 'anthropic'
        ? (data?.content || []).map((part) => part?.text || '').join('')
        : format === 'openai-responses'
          ? data?.output_text || (data?.output || []).flatMap((item) => item?.content || []).map((part) => part?.text || part?.output_text || '').join('')
        : data?.choices?.[0]?.message?.content || '';
    // v2.18.2: forward finish_reason — orchestrator 用它侦测截断 ('length' 表示撞 maxTokens)
    const finishReason = format === 'gemini'
      ? data?.candidates?.[0]?.finishReason || ''
      : format === 'anthropic'
        ? data?.stop_reason || ''
        : format === 'openai-responses' ? data?.status || '' : data?.choices?.[0]?.finish_reason || '';
    const usage = data?.usage || data?.usageMetadata || null;
    process.stdout.write(JSON.stringify({ ok: true, content, elapsed, finishReason, usage }));
    process.exit(0);
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
    process.stdout.write(JSON.stringify({ ok: false, error: msg }));
    process.exit(0);
  }
});
