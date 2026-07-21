use std::sync::RwLock;
use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;
use ort::inputs;
use ort::value::Tensor;
use tokenizers::Tokenizer;

pub static GLOBAL_EMBEDDING: RwLock<Option<EmbeddingEngine>> = RwLock::new(None);

pub struct EmbeddingEngine {
    session: Session,
    tokenizer: Tokenizer,
}

impl EmbeddingEngine {
    pub fn new(model_path: &str, tokenizer_path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .commit_from_file(model_path)?;  // ✅ 2.x 正确写法

        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| e.to_string())?;

        Ok(Self { session, tokenizer })
    }

    pub fn init_global(model_path: &str, tokenizer_path: &str) -> Result<(), String> {
        println!("[1] 开始初始化");
        
        // 先单独测 tokenizer
        println!("[2] 加载 tokenizer...");
        let tokenizer = Tokenizer::from_file(tokenizer_path)
            .map_err(|e| format!("tokenizer 失败: {}", e))?;
        println!("[3] tokenizer OK");
    
        // 再测 session
        println!("[4] 加载 ONNX session...");
        let session = Session::builder()
            .map_err(|e| format!("builder 失败: {:?}", e))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("opt level 失败: {:?}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("commit 失败: {:?}", e))?;
        println!("[5] session OK");
    
        let engine = EmbeddingEngine { session, tokenizer };
        let mut write_guard = GLOBAL_EMBEDDING.write().unwrap();
        *write_guard = Some(engine);
        
        println!("[6] 全部完成");
        Ok(())
    }  

    pub fn encode_global(text: &str) -> Result<Vec<f32>, String> {
        let mut write_guard = GLOBAL_EMBEDDING.write().unwrap();
        let engine = write_guard.as_mut().ok_or("Embedding 引擎尚未初始化，请先加载模型")?;
        engine.encode(text).map_err(|e| e.to_string())
    }

    pub fn encode(&mut self, text: &str) -> Result<Vec<f32>, Box<dyn std::error::Error>> {
        let encoding = self.tokenizer.encode(text, true)
            .map_err(|e| e.to_string())?;
    
        let input_ids: Vec<i64> = encoding.get_ids().iter().map(|&x| x as i64).collect();
        let attention_mask: Vec<i64> = encoding.get_attention_mask().iter().map(|&x| x as i64).collect();
        let token_type_ids: Vec<i64> = vec![0i64; input_ids.len()];
        let seq_len = input_ids.len();
        let shape = [1, seq_len];
    
        let input_ids_tensor = Tensor::from_array((shape, input_ids))?;
        let attention_mask_tensor = Tensor::from_array((shape, attention_mask))?;
        let token_type_ids_tensor = Tensor::from_array((shape, token_type_ids))?;
    
        let outputs = self.session.run(inputs![
            "input_ids" => input_ids_tensor,
            "attention_mask" => attention_mask_tensor,
            "token_type_ids" => token_type_ids_tensor,
        ])?;
    
        let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
        let hidden_size = shape[2] as usize;
    
        // ✅ CLS token pooling：只取第 0 个 token
        let mut pooled: Vec<f32> = data[0..hidden_size].to_vec();
    
        // L2 归一化（保持不变）
        let norm: f32 = pooled.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 1e-12 {
            pooled.iter_mut().for_each(|x| *x /= norm);
        }
    
        Ok(pooled)
    }
}