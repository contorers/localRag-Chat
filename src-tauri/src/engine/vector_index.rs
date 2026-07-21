use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;
use std::sync::RwLock;
use std::fs::File;
use std::io::{BufReader, BufWriter, Write, Read};
use crate::db::AppDb;

// ============================================================================
// 运行时配置（从 system_settings 读取，缺省值兜底）
// ============================================================================
#[derive(Debug, Clone)]
pub struct IndexConfig {
    pub dimensions: usize,
    pub num_projections: usize,
    pub num_probe_bits: usize,
    pub lsh_threshold: usize,
}

impl Default for IndexConfig {
    fn default() -> Self {
        Self {
            dimensions: 384,
            num_projections: 32,
            num_probe_bits: 2,
            lsh_threshold: 500_000,
        }
    }
}

impl IndexConfig {
    /// 从数据库的 system_settings 表读取配置，缺字段则用默认值
    pub fn load_from_db(db: &AppDb) -> Self {
        let default = Self::default();

        let setting = match db.get_system_settings(0) {
            Ok(Some(s)) => s,
            Ok(None) => {
                println!("[IndexConfig] system_settings id=1 不存在，使用默认配置");
                return default;
            }
            Err(e) => {
                println!("[IndexConfig] 读取 system_settings 失败: {}，使用默认配置", e);
                return default;
            }
        };

        let v: serde_json::Value = match serde_json::from_str(&setting.payload) {
            Ok(val) => val,
            Err(e) => {
                println!("[IndexConfig] payload 解析失败: {}，使用默认配置", e);
                return default;
            }
        };

        let cfg = Self {
            dimensions: v["dimensions"]
                .as_u64()
                .map(|x| x as usize)
                .unwrap_or(default.dimensions),
            num_projections: v["num_projections"]
                .as_u64()
                .map(|x| x as usize)
                .unwrap_or(default.num_projections),
            num_probe_bits: v["num_probe_bits"]
                .as_u64()
                .map(|x| x as usize)
                .unwrap_or(default.num_probe_bits),
            lsh_threshold: v["lsh_threshold"]
                .as_u64()
                .map(|x| x as usize)
                .unwrap_or(default.lsh_threshold),
        };

        println!(
            "[IndexConfig] 配置加载成功: dimensions={}, num_projections={}, \
             num_probe_bits={}, lsh_threshold={}",
            cfg.dimensions, cfg.num_projections, cfg.num_probe_bits, cfg.lsh_threshold
        );

        cfg
    }
}

// ============================================================================
// 按 id 列表从 SQLite 回表捞向量（LSH 搜索时用）
// ============================================================================
pub fn fetch_vectors_by_ids(
    db: &AppDb,
    table: &str,
    ids: &[u64],
    dimensions: usize,
) -> Result<Vec<(u64, Vec<f32>)>, String> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let conn = db.conn.lock().unwrap();

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, embedding FROM {} WHERE id IN ({})",
        table, placeholders
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<rusqlite::types::Value> = ids
        .iter()
        .map(|&id| rusqlite::types::Value::Integer(id as i64))
        .collect();

    let rows = stmt
        .query_map(rusqlite::params_from_iter(params.iter()), |row| {
            let id: i64 = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id as u64, blob))
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        let (id, blob) = row.map_err(|e| e.to_string())?;
        let vector: Vec<f32> = blob
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        if vector.len() == dimensions {
            result.push((id, vector));
        }
    }
    Ok(result)
}

// ============================================================================
// VectorIndex：根据数据量自动选择搜索策略
// ============================================================================
pub struct VectorIndex {
    config: IndexConfig,

    // 暴力模式用
    brute_ids: Vec<u64>,
    brute_vectors: Vec<f32>,

    // LSH 模式用
    projections: Vec<Vec<f32>>,
    buckets: HashMap<u32, Vec<u64>>,
    id_to_hash: HashMap<u64, u32>,
}

impl VectorIndex {
    pub fn new(config: IndexConfig) -> Self {
        let projections = Self::generate_projections(12345u64, &config);
        Self {
            config,
            brute_ids: Vec::new(),
            brute_vectors: Vec::new(),
            projections,
            buckets: HashMap::new(),
            id_to_hash: HashMap::new(),
        }
    }

    fn generate_projections(seed: u64, config: &IndexConfig) -> Vec<Vec<f32>> {
        let mut state = seed;
        let mut projections = Vec::with_capacity(config.num_projections);
        for _ in 0..config.num_projections {
            let mut plane = Vec::with_capacity(config.dimensions);
            for _ in 0..config.dimensions {
                state = state
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                let val = (state as i64) as f32 / i64::MAX as f32;
                plane.push(val);
            }
            let norm: f32 = plane.iter().map(|x| x * x).sum::<f32>().sqrt();
            plane.iter_mut().for_each(|x| *x /= norm);
            projections.push(plane);
        }
        projections
    }

    fn hash(&self, vector: &[f32]) -> u32 {
        let mut h: u32 = 0;
        for (i, proj) in self.projections.iter().enumerate() {
            let dot: f32 = proj.iter().zip(vector).map(|(a, b)| a * b).sum();
            if dot > 0.0 {
                h |= 1u32 << i;
            }
        }
        h
    }

    fn probe_hashes(&self, h: u32) -> Vec<u32> {
        let num_projections = self.config.num_projections;
        let num_probe_bits = self.config.num_probe_bits;

        let mut probes = vec![h];
        for bit in 0..num_projections {
            probes.push(h ^ (1u32 << bit));
        }
        if num_probe_bits >= 2 {
            for bit1 in 0..num_projections {
                for bit2 in (bit1 + 1)..num_projections {
                    probes.push(h ^ (1u32 << bit1) ^ (1u32 << bit2));
                }
            }
        }
        probes
    }

    pub fn is_lsh_mode(&self) -> bool {
        self.id_to_hash.len() >= self.config.lsh_threshold
    }

    pub fn has_similar(&self, vector: &[f32], threshold: f32) -> bool {
        if self.is_lsh_mode() {
            let h = self.hash(vector);
            self.buckets.get(&h).map(|b| !b.is_empty()).unwrap_or(false)
        } else {
            let results = self.search_brute(vector, 1);
            results.first().map(|(_, score)| *score > threshold).unwrap_or(false)
        }
    }

    pub fn add(&mut self, id: u64, vector: &[f32]) {
        // 暴力模式数据
        self.brute_ids.push(id);
        self.brute_vectors.extend_from_slice(vector);

        // LSH 数据
        let h = self.hash(vector);
        self.buckets.entry(h).or_default().push(id);
        self.id_to_hash.insert(id, h);

        // 达到阈值时释放暴力模式的向量内存，切换到 LSH
        if self.id_to_hash.len() == self.config.lsh_threshold {
            println!(
                "[VectorIndex] 数据量达到 {}，切换为 LSH 模式，释放向量内存",
                self.config.lsh_threshold
            );
            self.brute_ids.clear();
            self.brute_ids.shrink_to_fit();
            self.brute_vectors.clear();
            self.brute_vectors.shrink_to_fit();
        }
    }

    pub fn search(
        &self,
        query: &[f32],
        limit: usize,
        db: &AppDb,
        table: &str,
    ) -> Result<Vec<(u64, f32)>, String> {
        if self.len() == 0 {
            return Ok(vec![]);
        }
        if self.is_lsh_mode() {
            self.search_lsh(query, limit, db, table)
        } else {
            Ok(self.search_brute(query, limit))
        }
    }

    fn search_brute(&self, query: &[f32], limit: usize) -> Vec<(u64, f32)> {
        let dimensions = self.config.dimensions;
        let mut scores: Vec<(usize, f32)> = self.brute_vectors
            .chunks_exact(dimensions)
            .enumerate()
            .map(|(i, v)| {
                let score: f32 = query.iter().zip(v).map(|(a, b)| a * b).sum();
                (i, score)
            })
            .collect();

        if scores.len() > limit {
            let (top_k, _, _) = scores.select_nth_unstable_by(limit, |a, b| {
                b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
            });
            top_k.sort_unstable_by(|a, b| {
                b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
            });
            top_k.iter().map(|&(i, score)| (self.brute_ids[i], score)).collect()
        } else {
            scores.sort_unstable_by(|a, b| {
                b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
            });
            scores.into_iter().map(|(i, score)| (self.brute_ids[i], score)).collect()
        }
    }

    fn search_lsh(
        &self,
        query: &[f32],
        limit: usize,
        db: &AppDb,
        table: &str,
    ) -> Result<Vec<(u64, f32)>, String> {
        let h = self.hash(query);
        let probes = self.probe_hashes(h);

        let mut seen: HashSet<u64> = HashSet::new();
        let mut candidate_ids: Vec<u64> = Vec::new();
        for probe_h in probes {
            if let Some(bucket) = self.buckets.get(&probe_h) {
                for &id in bucket {
                    if seen.insert(id) {
                        candidate_ids.push(id);
                    }
                }
            }
        }

        if candidate_ids.is_empty() {
            return Ok(vec![]);
        }

        let vectors = fetch_vectors_by_ids(db, table, &candidate_ids, self.config.dimensions)?;

        let mut scores: Vec<(u64, f32)> = vectors
            .iter()
            .map(|(id, v)| {
                let score: f32 = query.iter().zip(v.iter()).map(|(a, b)| a * b).sum();
                (*id, score)
            })
            .collect();

        scores.sort_unstable_by(|a, b| {
            b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
        });
        scores.truncate(limit);
        Ok(scores)
    }

    pub fn len(&self) -> usize {
        self.id_to_hash.len()
    }

    // ========================================================================
    // 序列化：文件头加入 config，兼容性由 magic 版本号保证
    // ========================================================================
    pub fn save(&self, path: &str) -> Result<(), String> {
        let mut f = BufWriter::new(File::create(path).map_err(|e| e.to_string())?);

        // magic + 版本（升至 04，因为 config 字段变化）
        f.write_all(b"LSHIDX04").map_err(|e| e.to_string())?;

        let mode: u8 = if self.is_lsh_mode() { 1 } else { 0 };
        f.write_all(&[mode]).map_err(|e| e.to_string())?;

        // 写入运行时 config（4 个 u64）
        f.write_all(&(self.config.dimensions as u64).to_le_bytes()).map_err(|e| e.to_string())?;
        f.write_all(&(self.config.num_projections as u64).to_le_bytes()).map_err(|e| e.to_string())?;
        f.write_all(&(self.config.num_probe_bits as u64).to_le_bytes()).map_err(|e| e.to_string())?;
        f.write_all(&(self.config.lsh_threshold as u64).to_le_bytes()).map_err(|e| e.to_string())?;

        // 投影平面
        for proj in &self.projections {
            for val in proj {
                f.write_all(&val.to_le_bytes()).map_err(|e| e.to_string())?;
            }
        }

        let n = self.id_to_hash.len() as u64;
        f.write_all(&n.to_le_bytes()).map_err(|e| e.to_string())?;

        if mode == 0 {
            for (i, &id) in self.brute_ids.iter().enumerate() {
                f.write_all(&id.to_le_bytes()).map_err(|e| e.to_string())?;
                let vec_start = i * self.config.dimensions;
                for val in &self.brute_vectors[vec_start..vec_start + self.config.dimensions] {
                    f.write_all(&val.to_le_bytes()).map_err(|e| e.to_string())?;
                }
            }
        } else {
            for (&id, &hash) in &self.id_to_hash {
                f.write_all(&id.to_le_bytes()).map_err(|e| e.to_string())?;
                f.write_all(&hash.to_le_bytes()).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }

    pub fn load(path: &str) -> Result<Self, String> {
        let mut f = BufReader::new(File::open(path).map_err(|e| e.to_string())?);

        let mut magic = [0u8; 8];
        f.read_exact(&mut magic).map_err(|e| e.to_string())?;
        if &magic != b"LSHIDX04" {
            return Err("索引格式不匹配（版本变更），将从 SQLite 重建".to_string());
        }

        let mut mode_buf = [0u8; 1];
        f.read_exact(&mut mode_buf).map_err(|e| e.to_string())?;
        let mode = mode_buf[0];

        // 读取保存时的 config
        let mut buf8 = [0u8; 8];

        f.read_exact(&mut buf8).map_err(|e| e.to_string())?;
        let dimensions = u64::from_le_bytes(buf8) as usize;

        f.read_exact(&mut buf8).map_err(|e| e.to_string())?;
        let num_projections = u64::from_le_bytes(buf8) as usize;

        f.read_exact(&mut buf8).map_err(|e| e.to_string())?;
        let num_probe_bits = u64::from_le_bytes(buf8) as usize;

        f.read_exact(&mut buf8).map_err(|e| e.to_string())?;
        let lsh_threshold = u64::from_le_bytes(buf8) as usize;

        let config = IndexConfig { dimensions, num_projections, num_probe_bits, lsh_threshold };

        // 投影平面
        let mut projections = Vec::with_capacity(config.num_projections);
        for _ in 0..config.num_projections {
            let mut plane = Vec::with_capacity(config.dimensions);
            for _ in 0..config.dimensions {
                let mut buf4 = [0u8; 4];
                f.read_exact(&mut buf4).map_err(|e| e.to_string())?;
                plane.push(f32::from_le_bytes(buf4));
            }
            projections.push(plane);
        }

        let mut buf8 = [0u8; 8];
        f.read_exact(&mut buf8).map_err(|e| e.to_string())?;
        let n = u64::from_le_bytes(buf8) as usize;

        let mut index = VectorIndex {
            config,
            brute_ids: Vec::new(),
            brute_vectors: Vec::new(),
            projections,
            buckets: HashMap::new(),
            id_to_hash: HashMap::new(),
        };

        if mode == 0 {
            for _ in 0..n {
                let mut buf8 = [0u8; 8];
                f.read_exact(&mut buf8).map_err(|e| e.to_string())?;
                let id = u64::from_le_bytes(buf8);

                let mut vec = Vec::with_capacity(index.config.dimensions);
                for _ in 0..index.config.dimensions {
                    let mut buf4 = [0u8; 4];
                    f.read_exact(&mut buf4).map_err(|e| e.to_string())?;
                    vec.push(f32::from_le_bytes(buf4));
                }

                let h = index.hash(&vec);
                index.brute_ids.push(id);
                index.brute_vectors.extend_from_slice(&vec);
                index.buckets.entry(h).or_default().push(id);
                index.id_to_hash.insert(id, h);
            }
        } else {
            for _ in 0..n {
                let mut buf8 = [0u8; 8];
                f.read_exact(&mut buf8).map_err(|e| e.to_string())?;
                let id = u64::from_le_bytes(buf8);

                let mut buf4 = [0u8; 4];
                f.read_exact(&mut buf4).map_err(|e| e.to_string())?;
                let hash = u32::from_le_bytes(buf4);

                index.buckets.entry(hash).or_default().push(id);
                index.id_to_hash.insert(id, hash);
            }
        }

        Ok(index)
    }

    pub fn build_from_db(db: &AppDb, table: &str, config: IndexConfig) -> Result<Self, String> {
        let conn = db.conn.lock().unwrap();

        let mut stmt = conn
            .prepare(&format!(
                "SELECT id, embedding FROM {} WHERE embedding IS NOT NULL",
                table
            ))
            .map_err(|e| e.to_string())?;

        let dimensions = config.dimensions;
        let rows = stmt
            .query_map([], |row| {
                let id: i64 = row.get(0)?;
                let blob: Vec<u8> = row.get(1)?;
                Ok((id as u64, blob))
            })
            .map_err(|e| e.to_string())?;

        let mut index = Self::new(config);
        for row in rows {
            let (id, blob) = row.map_err(|e| e.to_string())?;
            let vector: Vec<f32> = blob
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect();
            if vector.len() == dimensions {
                index.add(id, &vector);
            }
        }
        Ok(index)
    }
}

// ============================================================================
// 全局索引 + 对外接口
// ============================================================================

pub static MESSAGE_INDEX: LazyLock<RwLock<Option<VectorIndex>>> =
    LazyLock::new(|| RwLock::new(None));

pub static FACT_INDEX: LazyLock<RwLock<Option<VectorIndex>>> =
    LazyLock::new(|| RwLock::new(None));

const MESSAGE_INDEX_FILE: &str = "message_vectors.bin";
const FACT_INDEX_FILE: &str = "fact_vectors.bin";

pub fn init_indexes(data_dir: &str, db: &AppDb) -> Result<(), String> {
    // 从 system_settings 读取配置，缺省值自动兜底
    let config = IndexConfig::load_from_db(db);

    // ── 消息索引 ──────────────────────────────────────────────────────────────
    let msg_path = format!("{}/{}", data_dir, MESSAGE_INDEX_FILE);
    let msg_index = if std::path::Path::new(&msg_path).exists() {
        println!("[VectorIndex] 从磁盘加载消息索引...");
        VectorIndex::load(&msg_path).unwrap_or_else(|e| {
            println!("[VectorIndex] 格式变更，重建中: {}", e);
            VectorIndex::build_from_db(db, "chat_messages", config.clone()).unwrap()
        })
    } else {
        println!("[VectorIndex] 从 SQLite 重建消息索引...");
        VectorIndex::build_from_db(db, "chat_messages", config.clone())?
    };
    println!(
        "[VectorIndex] 消息索引共 {} 条，模式: {}",
        msg_index.len(),
        if msg_index.is_lsh_mode() { "LSH" } else { "暴力扫描" }
    );
    *MESSAGE_INDEX.write().unwrap() = Some(msg_index);

    // ── 事实索引 ──────────────────────────────────────────────────────────────
    let fact_path = format!("{}/{}", data_dir, FACT_INDEX_FILE);
    let fact_index = if std::path::Path::new(&fact_path).exists() {
        println!("[VectorIndex] 从磁盘加载事实索引...");
        VectorIndex::load(&fact_path).unwrap_or_else(|e| {
            println!("[VectorIndex] 格式变更，重建中: {}", e);
            VectorIndex::build_from_db(db, "vectors", config.clone()).unwrap()
        })
    } else {
        println!("[VectorIndex] 从 SQLite 重建事实索引...");
        VectorIndex::build_from_db(db, "vectors", config.clone())?
    };
    println!(
        "[VectorIndex] 事实索引共 {} 条，模式: {}",
        fact_index.len(),
        if fact_index.is_lsh_mode() { "LSH" } else { "暴力扫描" }
    );
    *FACT_INDEX.write().unwrap() = Some(fact_index);

    Ok(())
}

pub fn add_message_vector(id: u64, vector: &[f32]) -> Result<(), String> {
    let mut guard = MESSAGE_INDEX.write().unwrap();
    guard
        .get_or_insert_with(|| VectorIndex::new(IndexConfig::default()))
        .add(id, vector);
    Ok(())
}

pub fn add_fact_vector(id: u64, vector: &[f32]) -> Result<(), String> {
    let mut guard = FACT_INDEX.write().unwrap();
    guard
        .get_or_insert_with(|| VectorIndex::new(IndexConfig::default()))
        .add(id, vector);
    Ok(())
}

pub fn search_messages(
    query: &[f32],
    limit: usize,
    db: &AppDb,
) -> Result<Vec<(u64, f32)>, String> {
    let guard = MESSAGE_INDEX.read().unwrap();
    let index = guard.as_ref().ok_or("消息索引未初始化")?;
    index.search(query, limit, db, "chat_messages")
}

pub fn search_facts(
    query: &[f32],
    limit: usize,
    db: &AppDb,
) -> Result<Vec<(u64, f32)>, String> {
    let guard = FACT_INDEX.read().unwrap();
    let index = guard.as_ref().ok_or("事实索引未初始化")?;
    index.search(query, limit, db, "vectors")
}

pub fn save_indexes(data_dir: &str) -> Result<(), String> {
    {
        let msg_path = format!("{}/{}", data_dir, MESSAGE_INDEX_FILE);
        let guard = MESSAGE_INDEX.read().unwrap();
        if let Some(index) = guard.as_ref() {
            index.save(&msg_path)?;
            println!("[VectorIndex] 消息索引已保存 {} 条", index.len());
        }
    }
    {
        let fact_path = format!("{}/{}", data_dir, FACT_INDEX_FILE);
        let guard = FACT_INDEX.read().unwrap();
        if let Some(index) = guard.as_ref() {
            index.save(&fact_path)?;
            println!("[VectorIndex] 事实索引已保存 {} 条", index.len());
        }
    }
    Ok(())
}