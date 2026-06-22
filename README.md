# AuraGate Agent Settlement Console

Dashboard 5 agent mua API trực tiếp từ [AuraGate](https://github.com/mrcocdilinh/AuraGate) bằng x402 + USDC trên Arc Testnet. Không có mock mode và không có fallback giả lập.

## Chạy local

```bash
npm install
npm run dev
```

Mở `http://localhost:3000`.

## Chuẩn bị

1. Tạo 5 ví **riêng cho Arc Testnet** và nạp Arc Testnet USDC vào từng ví.
2. Chọn một agent, nhập private key của ví tương ứng, bấm `Connect wallet` để đọc wallet/Gateway balance.
3. Chọn 1–6 API từ catalog live của AuraGate.
4. Tuỳ chọn nhập Groq API key. Key này chỉ được dùng để gửi kết quả API đã mua tới model `llama-3.3-70b-versatile`.
5. Bấm `Run live purchase`, đọc tổng phí tối đa và xác nhận.

Nếu Gateway balance chưa đủ, console tự approve + deposit đúng phần thiếu rồi mới ký các khoản thanh toán.

## Luồng giao dịch

```text
AuraGate catalog (phải là live + chain 5042002)
  → GET/POST không payment
  → xác nhận HTTP 402 thật
  → ký EIP-3009 bằng ví của agent
  → Circle Gateway settle USDC
  → AuraGate trả HTTP 200 + dữ liệu
  → console hiển thị settlement tx, receipt, result hash và JSON
```

Mỗi lượt bị chặn ở mức tối đa `0.25 USDC`, tối đa 6 API. URL thanh toán luôn được lấy từ catalog AuraGate; client không thể gửi một URL tuỳ ý vào payment route.

## Bảo mật private key

- Private key và Groq key chỉ nằm trong React state và body của request đang chạy.
- Không dùng `localStorage`, cookie, database hoặc log key.
- Error trả về được redact chuỗi giống private key/Groq key.
- Nên chạy local. Nếu deploy, bắt buộc dùng HTTPS, authentication và một backend riêng được khóa mạng.
- **Không nhập ví mainnet hoặc ví đang giữ tài sản có giá trị.** Hãy dùng ví testnet chuyên biệt.

## “Thật” nghĩa là gì?

Repo AuraGate hiện dùng **Arc Testnet** (`chainId 5042002`). App tạo giao dịch blockchain, approval/deposit, settlement và receipt thật trên testnet, nhưng Arc Testnet USDC không phải USDC mainnet có giá trị quy đổi. Console chủ động dừng nếu AuraGate không ở `live` mode hoặc catalog không trỏ đúng Arc Testnet.

## Kiểm tra

```bash
npm run typecheck
npm run build
npm audit --omit=dev
```

Explorer: <https://testnet.arcscan.app>  
AuraGate receipts: <https://auragate.app/receipts>
