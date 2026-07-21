// hybridSearch.js

/**
 * 分析查询意图，决定 RRF 融合时的权重倾向
 * 返回: { type: 'keyword' | 'semantic' | 'balanced' }
 */
export function analyzeQueryIntent(query) {
  const q = query.toLowerCase();
  
  // 1. 强代码/报错特征：永远优先使用关键词匹配 (精准查找变量名或报错日志)
  const codeRegex = /[{}[\]()]|=>|===|\.[a-zA-Z]|error|exception/i;
  if (codeRegex.test(q)) return "keyword";

  // 2. 指代/对比特征：回归平衡 (既需要找到旧概念，又需要理解上下文)
  const referentialRegex = /(相比|区别|不同|之前|那个|旧的|原来)/i;
  if (referentialRegex.test(q)) return "balanced";

  // 3. 长句特征：用户在描述一个模糊的概念或业务逻辑，高度信任向量语义
  if (q.length > 30) return "semantic";

  return "balanced";
}

/**
 * 纯净版 RRF 混合重排算法
 * 已彻底移除 importance，回归纯粹的数学融合
 */ 
export function reciprocalRankFusion(
  keywordResults = [],
  semanticResults = [],
  intent = "balanced",
  k = 30
) {
  // k 作为一个平滑常数，业界通常取 60，但在局部小规模对话检索中 30 是一个非常棒的值
  const combinedScores = new Map();

  // 1. 动态权重分配
  let keywordWeight = 1.0;
  let semanticWeight = 1.0;

  if (intent === "keyword") {
    keywordWeight = 1.6;
    semanticWeight = 0.4;
  } else if (intent === "semantic") {
    keywordWeight = 0.4;
    semanticWeight = 1.6;
  }

  // 2. 处理关键词排名 (MiniSearch)
  keywordResults.forEach((doc, index) => {
    if (!doc || !doc.id) return;
    const rank = index + 1;
    
    // 🌟 核心修改 1：移除 importanceBoost，回归纯正 RRF 公式
    const rrfScore = (1 / (k + rank)) * keywordWeight;
    
    combinedScores.set(String(doc.id), { doc, score: rrfScore });
  });

  // 3. 处理语义排名 (Vector)
  semanticResults.forEach((doc, index) => {
    if (!doc || !doc.id) return;
    const rank = index + 1;
    
    // 🌟 同理，移除 importanceBoost
    const rrfScore = (1 / (k + rank)) * semanticWeight;

    const idKey = String(doc.id);
    if (combinedScores.has(idKey)) {
      // 🌟 核心修改 2：移除硬编码的 * 1.5 乘数。
      // 标准的加法已经足够让同时出现在两边的结果瞬间霸榜
      const currentData = combinedScores.get(idKey);
      currentData.score += rrfScore; 
    } else {
      combinedScores.set(idKey, { doc, score: rrfScore });
    }
  });

  // 4. 最终排序并返回 Document
  return Array.from(combinedScores.values())
    .sort((a, b) => b.score - a.score)
    .map((item) => item.doc);
}