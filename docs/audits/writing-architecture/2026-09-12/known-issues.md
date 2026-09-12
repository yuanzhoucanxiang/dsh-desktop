# Known issues

1. **client 单文件仍大**：`src/client/entry.js` 约 3k 行；构建已单源化编辑会话与 context-builder，UI 拆分未完成。  
2. **备忘跨进程**：多实例同时写同一项目可能交错；依赖文件 rename，无 fcntl 锁。  
3. **companion 预设**：`ensureCompanionPreset` 依赖 store；安装/选择逻辑需在真实内核复核 H03。  
4. **真实模型**：未跑方案第 12 节体验测试。  
5. **entry `--check`**：工厂体含顶层 return，不能对 entry 单独 node --check；检查 client.js 产物即可。  

— ox-alpha
