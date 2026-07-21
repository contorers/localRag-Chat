use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let profile = env::var("PROFILE").unwrap();
    
    let target_dir = manifest_dir.join("target").join(profile);
    let libs_dir = manifest_dir.join("libs");

    // 监听整个 libs 目录变化
    println!("cargo:rerun-if-changed=libs/");

    if libs_dir.exists() {
        for entry in fs::read_dir(&libs_dir).unwrap() {
            let entry = entry.unwrap();
            let src = entry.path();
            let dst = target_dir.join(entry.file_name());
            fs::copy(&src, &dst).expect(&format!("复制 {:?} 失败", src));
        }
    }

    tauri_build::build()
}