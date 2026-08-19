# HƯỚNG DẪN CONFIG BACKUP & RESTORE CHUẨN PRODUCTION CHO DỊCH VỤ DBAAS TRÊN CMC CLOUD

Tài liệu này đặc tả chính sách sao lưu (Backup), khôi phục (Restore) dữ liệu cho các phân hệ Cơ sở dữ liệu (PostgreSQL, MongoDB, Redis) của ứng dụng Clouddit chạy trên hạ tầng Database-as-a-Service (DBaaS) của CMC Cloud.

---

## 1. Phân Loại Dữ Liệu & Chính Sách Sao Lưu (Backup Audit)

Hệ thống Clouddit chạy trên kiến trúc đa cơ sở dữ liệu (Polyglot Persistence). Mỗi DB đảm nhận một vai trò khác nhau nên cần chính sách backup riêng biệt để tối ưu hiệu năng và chi phí:

### 1.1. PostgreSQL (Source of Truth - Dữ liệu cốt lõi)
*   **Độ quan trọng**: **Mức cao nhất (Class A - Critical)**. Chứa tài khoản người dùng, bài viết, bình luận, phiếu bầu. Mất dữ liệu này đồng nghĩa với hỏng hệ thống hoàn toàn.
*   **Chính sách Backup**:
    *   **Automated Daily Snapshot**: Tự động chụp snapshot toàn bộ instance DB hàng ngày vào khung giờ thấp tải (02:00 - 04:00 AM GMT+7). Thời gian lưu trữ (Retention): **30 ngày**.
    *   **Continuous WAL Archiving (Point-in-Time Recovery - PITR)**: Nhật ký ghi trước (Write-Ahead Logs) được đồng bộ liên tục lên Object Storage của CMC Cloud (S3-compatible) cứ mỗi 5 phút một lần. Cho phép khôi phục chính xác tới từng giây lịch sử. Thời gian lưu trữ WAL: **7 ngày**.

### 1.2. MongoDB (Activity logs & Notifications - Nhật ký thông báo)
*   **Độ quan trọng**: **Mức trung bình (Class B - Important)**. Chứa lịch sử thông báo đẩy. Nếu mất, người dùng chỉ bị mất lịch sử chuông báo cũ, không ảnh hưởng tính năng cốt lõi.
*   **Chính sách Backup**:
    *   **Automated Daily Backup**: Tự động snapshot hàng ngày. Thời gian lưu trữ: **14 ngày**. Không cần lưu trữ WAL/PITR liên tục để tiết kiệm dung lượng lưu trữ đĩa.

### 1.3. Redis (Cache & WebSocket Pub/Sub - Bộ nhớ tạm)
*   **Độ quan trọng**: **Không cần thiết (Class C - Volatile)**. Chỉ chứa dữ liệu đếm số lượng chưa đọc tạm thời và truyền tin WebSocket. 
*   **Chính sách Backup**: **KHÔNG BACKUP**. 
    *   *Lý do*: Redis chạy In-Memory hoàn toàn. Nếu Redis bị sập và mất sạch dữ liệu, hệ thống tự động sinh lại cache từ MongoDB thông qua cơ chế Cache Miss. Việc cấu hình backup ghi đĩa liên tục trên Redis (như AOF hay RDB) sẽ làm giảm hiệu năng RAM nghiêm trọng và gây lãng phí dung lượng lưu trữ đắt đỏ.

---

## 2. Quy Trình Thiết Lập Backup Trên CMC Cloud Portal

Để thiết lập DBaaS Backup đúng chuẩn Production, thực hiện các bước sau trên giao diện quản trị CMC Cloud Portal:

1.  **Thiết lập Backup Window (Khung giờ sao lưu)**:
    *   Truy cập dịch vụ DBaaS (PostgreSQL/MongoDB) -> Chọn Instance -> **Backup & Recovery**.
    *   Cấu hình giờ bắt đầu vào **03:00 AM** (Khung giờ traffic thấp nhất của người dùng Việt Nam) để giảm thiểu I/O lag trên database chính.
2.  **Kích hoạt Point-in-Time Recovery (PITR)**:
    *   Trong mục cấu hình PostgreSQL, bật **Continuous Backups**. Hệ thống tự động kích hoạt tính năng đóng gói file WAL lưu vào phân vùng Object Storage cô lập.
3.  **Cấu hình Sao chép chéo vùng (Cross-Region Replication - Disaster Recovery)**:
    *   Để phòng ngừa rủi ro thảm họa cấp vùng (Disaster Recovery - ví dụ sập Datacenter HCM-1), cấu hình tự động nhân bản (replicate) các bản snapshot hàng ngày từ **Zone HCM-1** sang **Zone HN-1** của CMC Cloud.
4.  **Mã hóa Bản sao lưu (Backup Encryption)**:
    *   Tất cả các bản sao lưu (Snapshot) phải được bật mã hóa tự động ở trạng thái nghỉ bằng thuật toán **AES-256** thông qua Key Management Service (KMS) của CMC Cloud.

---

## 3. Quy Trình Khôi Phục Dữ Liệu Chuẩn Production (Restore Procedures)

> [!IMPORTANT]
> **NGUYÊN TẮC VÀNG TRONG PRODUCTION**: Không bao giờ được khôi phục đè (restore inplace) trực tiếp lên instance database đang chạy (Active DB). Mọi quy trình restore đều phải được khôi phục ra một **Instance mới (New DB Instance)** để đối chiếu trước khi trỏ Traffic vào.

### 3.1. Khôi phục PostgreSQL về một thời điểm cụ thể (Point-in-Time Recovery)
Khi xảy ra sự cố phá hoại dữ liệu (ví dụ hacker xóa bảng lúc 10:15:30 AM), quy trình phục hồi diễn ra như sau:

1.  **Khởi tạo Restore Instance**:
    *   Vào Portal CMC Cloud -> Chọn Instance PostgreSQL bị lỗi -> Click **Restore to point in time**.
    *   Chọn thời điểm khôi phục là **10:15:00 AM** (trước thời điểm bị xóa 30 giây).
    *   Đặt tên cho instance mới là `clouddit-pg-restored`. CMC Cloud sẽ tự động lấy bản snapshot gần nhất và áp các file WAL ghi nhận trước 10:15:00 AM vào máy ảo mới.
2.  **Kiểm tra tính toàn vẹn dữ liệu (Data Integrity Check)**:
    *   Sau khi instance `clouddit-pg-restored` khởi động xong, kỹ sư vận hành sử dụng Bastion Host kết nối vào kiểm tra cấu trúc dữ liệu, đếm số lượng bản ghi xem đã đầy đủ và sạch sẽ chưa.
3.  **Trỏ kết nối ứng dụng (Cutover)**:
    *   Cập nhật biến môi trường `DB_HOST` trong tệp `.env` của toàn bộ các máy chủ Backend Node.js từ IP cũ sang IP nội bộ mới của `clouddit-pg-restored`.
    *   Reload lại cụm PM2: `pm2 reload all`.
4.  **Dọn dẹp**:
    *   Instance cũ bị lỗi được giữ lại 48 tiếng để đối chiếu logs, sau đó tiến hành tắt và xóa bỏ để tránh phát sinh chi phí.

### 3.2. Khôi phục MongoDB
Do MongoDB lưu trữ nhật ký thông báo nên chỉ cần khôi phục về bản snapshot hàng ngày gần nhất:
1.  Chọn bản Daily Backup gần nhất trên Portal CMC Cloud.
2.  Nhấn **Restore to new instance** -> đặt tên `clouddit-mongo-restored`.
3.  Cập nhật chuỗi kết nối `MONGODB_URI` trong `.env` của Backend trỏ về IP của instance mới.
4.  Khởi chạy lại PM2.

---

## 4. Các Chỉ Số Mục Tiêu Phục Hồi Thảm Họa (DR Metrics)

Khi thiết lập hệ thống chuẩn Production, doanh nghiệp cần cam kết hai chỉ số đo lường hiệu quả phục hồi thảm họa:

*   **RPO (Recovery Point Objective - Điểm phục hồi mục tiêu)**: Khoảng thời gian mất mát dữ liệu tối đa chấp nhận được.
    *   *PostgreSQL*: **RPO < 5 phút** (nhờ cơ chế đồng bộ liên tục file WAL).
    *   *MongoDB*: **RPO < 24 giờ** (do chỉ backup snapshot 1 lần/ngày).
*   **RTO (Recovery Time Objective - Thời gian phục hồi mục tiêu)**: Tổng thời gian tối đa để hệ thống hoạt động bình thường trở lại kể từ khi sự cố xảy ra.
    *   *Toàn hệ thống*: **RTO < 30 phút** (bao gồm thời gian tạo instance mới từ snapshot và cập nhật cấu hình biến môi trường).

---
Tài liệu này được lưu trữ phục vụ cho quy trình kiểm thử định kỳ (Disaster Recovery Drill) 6 tháng một lần của đội ngũ vận hành RAD CMC Cloud.
