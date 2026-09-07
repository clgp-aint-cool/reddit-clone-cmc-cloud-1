# Kế Hoạch Triển Khai Slide BOM & Dự Toán Chi Phí Đầu Tư Hạ Tầng Clouddit (CMC Cloud)

Dựa trên mô hình kiến trúc hệ thống tại [cmc-cloud-architecture.png](file:///Users/caolegiaphu/Documents/cmc/reddit-project/slide/cmc-cloud-architecture.png) và tệp dữ liệu chi tiết cước phí [billing-detail-muge.csv](file:///Users/caolegiaphu/Documents/cmc/reddit-project/billing-detail-muge.csv), kế hoạch này thiết kế và bổ sung một slide chuyên biệt về **Dự toán Chi phí (Bill of Materials - BOM)** và **Hiệu quả Đầu tư (TCO/ROI)** vào bài thuyết trình [ARCHITECTURE_PRESENTATION.html](file:///Users/caolegiaphu/Documents/cmc/reddit-project/slide/ARCHITECTURE_PRESENTATION.html).

---

## User Review Required

> [!IMPORTANT]
> **Xác nhận tổng dự toán BOM Production**:
> - **Tổng cước phí trong CSV (bao gồm PoC/Test)**: `20,793,250 VNĐ/tháng` (chứa các VM/DB thử nghiệm: `vpc-nghich-ngom`, MySQL test, PostgreSQL phụ, DB test...).
> - **Cước phí chuẩn kiến trúc Production Go-Live** (bám sát 100% sơ đồ `cmc-cloud-architecture.png`): **12,416,000 VNĐ/tháng** (~12.42 triệu VNĐ/tháng ≈ $480 USD/tháng).
> - Cả hai số liệu này sẽ được trình bày song song và đối soát rõ ràng để ban lãnh đạo/khách hàng thấy được tính minh bạch và khả năng tối ưu ngân sách khi đưa vào vận hành chính thức.

---

## Phân Tích Bóc Tách Chi Phí Thành Phần (BOM Breakdown)

Dựa trên 5 phân tầng chức năng trong sơ đồ kiến trúc:

### 1. Mạng & An Ninh Ngoại Vi (Network & Security)
- **VPC Mạng Riêng**: `cmc-prod-hcm1-vpc` (400,000 VNĐ/tháng)
- **pfSense Firewall Appliance**: VM 4 vCPUs - 4 GB RAM (900,000 VNĐ) + EV Root 20GB HighIO (54,000 VNĐ)
- **Bastion Host (Jumpbox)**: VM 1 vCPUs - 2 GB RAM (300,000 VNĐ) + EV Root 20GB HighIO (54,000 VNĐ)
- **2 Elastic IPs (EIPs)**: `101.99.59.220` (pfSense WAN) & `101.99.59.233` (Bastion SSH) (2 × 100,000 = 200,000 VNĐ)
*Tiểu kế Tầng 1*: **1,908,000 VNĐ/tháng**

### 2. Tầng Web (DMZ - Public Subnet 192.168.4.0/24)
- **Public ELB (Medium LB)**: 510,000 VNĐ/tháng (Layer 4/7 đón nhận traffic Internet)
- **Frontend Nginx Cluster (HA 2 Nodes)**: 
  - `reddit-frontend`: 2 vCPUs - 2 GB RAM + EV Root 20GB (504,000 VNĐ)
  - `reddit-frontend2`: 2 vCPUs - 2 GB RAM + EV Root 20GB (504,000 VNĐ)
*Tiểu kế Tầng 2*: **1,518,000 VNĐ/tháng**

### 3. Tầng Ứng Dụng (Private Subnet 192.168.6.0/24)
- **Private ELB (Medium LB)**: 510,000 VNĐ/tháng (Cân bằng tải nội bộ `reddit-backend-alb`)
- **Backend EC2 Cluster (Auto Scaling Min 2 Nodes)**:
  - `private_web_server_1`: 8 vCPUs - 8 GB RAM + EV Root 20GB (1,854,000 VNĐ)
  - `private_web_server_2`: 8 vCPUs - 8 GB RAM + EV Root 20GB (1,854,000 VNĐ)
*Tiểu kế Tầng 3*: **4,218,000 VNĐ/tháng**

### 4. Tầng Cơ Sở Dữ Liệu (Isolated DB Subnet 192.168.7.0/24)
- **PostgreSQL Production**: Plan 2 vCPUs - 4 GB RAM - 100 GB SSD + EV Volume 20GB (924,000 VNĐ)
- **MongoDB Production**: Plan 2 vCPUs - 4 GB RAM - 100 GB SSD + EV Volume 20GB (924,000 VNĐ)
- **Redis Production**: Plan 2 vCPUs - 4 GB RAM - 100 GB SSD + EV Volume 20GB (924,000 VNĐ)
*Tiểu kế Tầng 4*: **2,772,000 VNĐ/tháng**

### 5. Lưu Trữ & Sao Lưu Thảm Họa (Storage & DR)
- **CMC S3 Standard Storage (1,000 GB)**: 1,000,000 VNĐ/tháng (Lưu trữ ảnh/media người dùng Clouddit)
- **Cloud Backup Vault (1,000 GB)**: `vault-vs26` 1,000,000 VNĐ/tháng (Daily snapshot tự động toàn cụm)
*Tiểu kế Tầng 5*: **2,000,000 VNĐ/tháng**

---
**TỔNG CHI PHÍ VẬN HÀNH PRODUCTION (OPEX)**: **12,416,000 VNĐ / Tháng** (~148,992,000 VNĐ/năm).

---

## Proposed Changes

### Presentation Slides

#### [MODIFY] [ARCHITECTURE_PRESENTATION.html](file:///Users/caolegiaphu/Documents/cmc/reddit-project/slide/ARCHITECTURE_PRESENTATION.html)

1. **Bổ sung CSS chuyên biệt cho BOM slide**:
   - Styling bảng BOM `.bom-table`: Thiết kế compact, có phân chia 5 tier rõ ràng, badge thông số kỹ thuật, màu sắc tương phản cao (neon cyan, neon green, amber).
   - Card KPI tổng mức đầu tư `.bom-kpi-card`: Hiển thị số to nổi bật `12.42 Triệu / tháng`, tag so sánh CapEx vs OpEx.
   - Bảng đơn giá tham chiếu CMC Cloud (Compute, DBaaS, Storage, Network).
   - Thanh cuộn tinh tế `.bom-scroll` đảm bảo trải nghiệm trình chiếu mượt mà trên mọi tỷ lệ màn hình.

2. **Cập nhật Slide 1 (Title)**:
   - Cập nhật số slide từ `22 slides` thành `23 slides`.
   - Bổ sung `BOM & TCO Cost` vào chuỗi danh mục nội dung.

3. **Chèn Slide 22 mới**:
   - Vị trí: Ngay sau Slide 21 (Tối ưu hóa chi phí) và trước Slide 23 (Persuasion Pitch).
   - Nội dung:
     - **Bên trái (62%)**: Bảng BOM chi tiết từng tầng hạ tầng với đầy đủ số lượng, đơn giá, thành tiền và ghi chú chức năng. Dòng Total nổi bật với hiệu ứng neon glow.
     - **Bên phải (38%)**: 
       - Card 1: Tổng quan kinh tế (12.42 Triệu/tháng, CapEx = 0đ, Tiết kiệm ban đêm nhờ Auto Scaling).
       - Card 2: Bảng đơn giá chuẩn dịch vụ CMC Cloud (Cheatsheet).
       - Card 3: Phân tích đối soát PoC Lab (20.79M) vs Chuẩn Production (12.42M).

4. **Đổi ID và số thứ tự**:
   - Đổi slide cuối hiện tại thành `id="s23"`.
   - Cập nhật thanh điều hướng: `<span class="ncnt" id="cnt">1 / 23</span>`.

---

## Verification Plan

### Automated / Browser Verification
1. Kiểm tra cú pháp HTML của [ARCHITECTURE_PRESENTATION.html](file:///Users/caolegiaphu/Documents/cmc/reddit-project/slide/ARCHITECTURE_PRESENTATION.html) không có thẻ mở/đóng sai.
2. Khởi chạy subagent browser hoặc công cụ preview mở file để kiểm tra:
   - Slide 22 mới hiển thị đẹp mắt, không bị vỡ layout hay tràn chữ.
   - Bấm phím mũi tên `→` và `←` chuyển slide bình thường từ Slide 1 đến Slide 23.
   - Thanh tiến độ (progress bar) và bộ đếm `1 / 23` cập nhật chính xác.
   - Hiệu ứng hover, màu sắc cyberpunk/CMC Cloud hài hòa với toàn bộ bộ slide.
