# PIP_快传（局域网网页共享）

局域网文件互传工具，默认以网页方式共享给同事使用（无需安装客户端）。

---

<img width="3837" height="1221" alt="image" src="https://github.com/user-attachments/assets/082dcbb9-e3a0-405e-8679-0e5fe4068551" />
<img width="3249" height="957" alt="94f1f83624b74cf8f3d74853de174a64" src="https://github.com/user-attachments/assets/dff29999-c3e0-4489-8a29-237c9b2cc822" />


## 一、当前版本流程（已更新）

### 母服务器流程

1. 在一台电脑启动 `npm start`。
2. 服务监听 `0.0.0.0:9999`，控制台会输出可访问地址：
   `Web share ready: http://<本机局域网IPv4>:9999`
3. 把这个地址发给同事即可。

### 同事使用流程

1. 同事在同一局域网中，用浏览器打开母服务器地址。
2. 可直接进行上传、下载、建目录、重命名、移动、删除。
3. 支持多选文件批量下载。
4. 可在前端打开“查看日志”查看操作日志。

### 当前关键能力

- 网页直连模式（无需安装客户端）
- 上传进度/速度显示
- 拖拽上传（文件/文件夹）
- 文件夹上传并保留目录结构
- 文件/目录重命名、移动、删除
- 文件默认 24 小时临时存储，可升级永久
- 前端多选文件批量下载
- 前端日志面板查看审计日志
- 上传并发默认 8，按文件数量自动动态调整

---

## 二、部署教程（Windows / 局域网）

### 1) 环境准备

- Node.js 18+（建议 LTS）
- Windows PowerShell / CMD
- 同网段局域网（或已打通的公司内网）

### 2) 获取代码并安装依赖

```bash
npm install
```

### 3) 启动服务

```bash
npm start
```

看到以下日志说明启动成功：

- `Web share ready: http://<IP>:9999`
- `LAN server started at 0.0.0.0:9999`

### 4) 分享给同事

把 `http://<IP>:9999` 发给同事，同事浏览器直接打开即可使用。

---

## 三、首次使用建议

1. 左侧“用户ID（建议首次修改）”改成真实姓名。
2. 第一次联网时允许 Windows 防火墙放行 `node.exe`（专用网络）。
3. 推荐母服务器使用有线网络，传输更稳定。

---

## 四、日志与数据落盘

### 数据目录

- 应用代码：`BASE/pip_kuaichuan_desktop`
- 共享盘数据：`BASE/PIP_快传/shared_disk`
- 配置文件：`BASE/PIP_快传/data/config.json`
- 文件元数据：`BASE/PIP_快传/data/file_meta.json`
- 访问者映射：`BASE/PIP_快传/data/client_profiles.json`
- 审计日志：`BASE/PIP_快传/data/log.txt`
- 浏览器下载目录（桌面端下载功能）：`BASE/PIP_快传/downloads`

### 审计日志说明

`log.txt` 为永久日志，记录关键操作：

- 上传 / 下载 / 重命名 / 移动 / 删除 / 新建目录 / 升级永久

每条日志含：时间、动作、IP、用户ID、目标路径、详情。
前端可通过“查看日志”按钮读取最近日志。

---

## 五、常见问题排查

### 1) 同事在同一局域网打不开

- 确认同事访问的是母服务器显示的 IP（不是 localhost）。
- 确认双方在同一网段，且网络未启用 AP 隔离。
- 检查 Windows 防火墙是否放行 `node.exe` 入站。
- 用以下命令测试端口：

  ```powershell
  Test-NetConnection <母服务器IP> -Port 9999
  ```

### 2) 启动报端口占用（`EADDRINUSE`）

说明已有实例占用 9999，可结束旧进程或换端口。

### 3) 上传速度不理想

- 当前已启用动态并发上传（默认 8）。
- 建议优先使用有线网络并避免跨弱 Wi-Fi。

---

## 六、可选运行模式

### 网页共享模式（推荐）

```bash
npm start
```

### Electron 桌面模式

```bash
npm run start:desktop
```

### 打包（Windows）

```bash
npm run dist:win
# 或
npm run dist:portable
```
