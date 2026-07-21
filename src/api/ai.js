export function chatUserAIApi(baseUrl, data, signal = null, apiKey = "") { 
    // 1. 直接拼接传入的基础 URL 和路径，不写死任何后端路由
    // 注意处理结尾的斜杠，防止拼出 https://api.openai.com/v1//chat/completions
    const cleanBaseUrl = baseUrl.replace(/\/$/, ""); 
    const fullUrl = `${cleanBaseUrl}`;
  
    // 2. 动态设置 Headers，带上解密后的原生 API Key
    const headers = {
        "Content-Type": "application/json"
    };
    
    // 如果有 apiKey，按行业标准注入 Authorization 头
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
  
    return fetch(fullUrl, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(data),
        signal: signal
    });
  }