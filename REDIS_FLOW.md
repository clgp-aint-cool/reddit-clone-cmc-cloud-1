# Sơ đồ Luồng Hoạt động của Redis & Liên kết Cơ sở Dữ liệu

Tài liệu này chứa mã nguồn **Mermaid** mô tả kiến trúc đồng bộ thông báo thời gian thực bằng Redis Pub/Sub và lưu đệm dữ liệu (Caching) của dự án Clouddit trên cụm hạ tầng CMC Cloud.

---

## 1. Luồng đồng bộ Real-time qua Redis Pub/Sub & Liên kết Database

Sơ đồ dưới đây mô tả luồng đi của dữ liệu tương tác (ví dụ: bình luận, upvote) từ Trình duyệt người gửi, đi qua hệ thống Load Balancer phân tán, ghi vào các cơ sở dữ liệu (PostgreSQL, MongoDB) và đồng bộ qua Redis Pub/Sub để đẩy thông báo thời gian thực về Trình duyệt người nhận.

```mermaid
graph TD
    %% Định nghĩa Styles cho các node
    classDef client fill:#3b82f6,stroke:#1d4ed8,color:#fff,stroke-width:2px;
    classDef proxy fill:#10b981,stroke:#047857,color:#fff,stroke-width:2px;
    classDef backend fill:#f59e0b,stroke:#b45309,color:#fff,stroke-width:2px;
    classDef db fill:#8b5cf6,stroke:#6d28d9,color:#fff,stroke-width:2px;
    classDef redis fill:#ef4444,stroke:#b91c1c,color:#fff,stroke-width:2px;

    subgraph Client_Zone ["Vùng Người dùng (Browsers)"]
        BrowserA["Trình duyệt User A <br> (Gửi tương tác)"]:::client
        BrowserB["Trình duyệt User B <br> (Nhận notification)"]:::client
    end

    subgraph Proxy_Zone ["Vùng Phân phối (Proxy & Load Balancer)"]
        CF["Cloudflare <br> (SSL Termination & WebSockets)"]:::proxy
        PublicELB["Public ELB <br> (TCP Cổng 80 - Layer 4)"]:::proxy
        NginxFE["Nginx Frontend EC2 <br> (192.168.4.21)"]:::proxy
        PrivateALB["Private ALB <br> (192.168.6.126)"]:::proxy
    end

    subgraph Backend_Zone ["Vùng Ứng dụng (Private Subnet)"]
        Node1["Backend EC2-1 (192.168.6.229) <br> [Node.js + Socket.io]"]:::backend
        Node2["Backend EC2-2 (192.168.6.76) <br> [Node.js + Socket.io]"]:::backend
    end

    subgraph DB_Zone ["Vùng Dữ liệu Cô lập (Isolated Subnet)"]
        Postgres["PostgreSQL (192.168.7.251:5432) <br> [Source of Truth: Comments/Follows]"]:::db
        Mongo["MongoDB (192.168.7.155:27017) <br> [Notifications Store]"]:::db
        Redis["Redis Server (192.168.7.117:6379) <br> [Cache & Pub/Sub Broker]"]:::redis
    end

    %% Định tuyến Client và Load Balancers
    BrowserA -->|Gửi Comment/Upvote| CF
    CF --> PublicELB
    PublicELB --> NginxFE
    NginxFE -->|Định tuyến REST API| PrivateALB
    PrivateALB -->|Tải cân bằng ngẫu nhiên| Node2
    
    %% Kết nối WebSocket bền vững
    BrowserB ---|Kết nối WebSocket giữ chặt| Node1

    %% Thao tác cơ sở dữ liệu từ Node 2 (Nơi xử lý Request của A)
    Node2 -->|1. Lưu Comment/Upvote| Postgres
    Node2 -->|2. Tạo & Lưu Notification Document| Mongo
    Node2 -->|3. Tăng số lượng chưa đọc INCR| Redis
    Node2 -->|4. Publish payload sự kiện lên kênh 'notifications'| Redis

    %% Redis Pub/Sub Phân phối sự kiện
    Redis -.->|5. Broadcast sự kiện qua kênh Pub/Sub| Node1
    Redis -.->|Broadcast sự kiện qua kênh Pub/Sub| Node2

    %% Node 1 phát hiện User B kết nối cục bộ và đẩy tin
    Node1 -->|6. Gửi WebSocket event 'notification'| BrowserB
```

---

## 2. Luồng Cache Đếm số lượng thông báo chưa đọc (Unread Count Caching)

Sơ đồ tuần tự thể hiện cơ chế tiết kiệm tải cho MongoDB bằng cách lưu bộ đệm số lượng chưa đọc (Unread Count) vào Redis Cache với TTL (Time-To-Live) là 1 giờ.

```mermaid
sequenceDiagram
    autonumber
    actor UserB as Trình duyệt User B
    participant Node1 as Backend EC2-1
    participant Redis as Redis Cache (Port 6379)
    participant Mongo as MongoDB (Port 27017)

    UserB->>Node1: GET /api/notifications/unread-count
    Note over Node1: Kiểm tra Cache trong Redis
    Node1->>Redis: GET unread_count:UserB_ID
    
    alt Cache HIT (Có dữ liệu trong Cache)
        Redis-->>Node1: Trả về số lượng chưa đọc (Ví dụ: 5)
        Node1-->>UserB: HTTP 200 { unreadCount: 5 } (Trả về ngay lập tức)
    else Cache MISS (Chưa có dữ liệu hoặc cache hết hạn TTL)
        Redis-->>Node1: Trả về null
        Note over Node1: Truy vấn đếm trực tiếp trên MongoDB
        Node1->>Mongo: countDocuments({ userId: UserB_ID, isRead: false })
        Mongo-->>Node1: Trả về số lượng từ DB (Ví dụ: 5)
        Note over Node1: Đồng bộ lưu lại số lượng vào Redis Cache (TTL 1 giờ)
        Node1->>Redis: SETEX unread_count:UserB_ID 3600 5
        Node1-->>UserB: HTTP 200 { unreadCount: 5 }
    end
```

---

## Hướng dẫn Render hình ảnh

Để xem trực quan sơ đồ trên:
1. Mở file này trong VS Code và nhấn nút **Markdown Preview** (`Ctrl + Shift + V` hoặc `Cmd + Shift + V` trên Mac).
2. Hoặc bạn có thể truy cập trang tài liệu [**`ARCHITECTURE_GUIDE.html`**](file:///Users/caolegiaphu/Documents/cmc/reddit-project/ARCHITECTURE_GUIDE.html), các sơ đồ này đã được nhúng trực tiếp và render tự động bằng thư viện **Mermaid.js**.
