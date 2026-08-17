if (typeof requireAuth === "function") {
  requireAuth();
}

let offset = 0;
const limit = 15;
let allLoaded = false;

async function loadNotifications(showSkeleton = true) {
  const feed = document.getElementById("notificationsFeed");
  if (!feed) return;
  
  if (showSkeleton && offset === 0) {
    feed.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  }
  
  try {
    const data = await api(`/notifications?limit=${limit}&offset=${offset}`);
    
    if (offset === 0) {
      feed.innerHTML = "";
    }
    
    const countRes = await api("/notifications/unread-count");
    const markAllBtn = document.getElementById("markAllReadBtn");
    if (markAllBtn) {
      markAllBtn.style.display = countRes.unreadCount > 0 ? "block" : "none";
    }
    
    if (data.length === 0 && offset === 0) {
      feed.innerHTML = '<div class="empty">You have no notifications.</div>';
      document.getElementById("paginationWrap").style.display = "none";
      return;
    }
    
    if (data.length < limit) {
      allLoaded = true;
      document.getElementById("paginationWrap").style.display = "none";
    } else {
      allLoaded = false;
      document.getElementById("paginationWrap").style.display = "block";
    }
    
    data.forEach(n => {
      const card = document.createElement("div");
      card.className = `card notification-card ${n.isRead ? "" : "unread"}`;
      card.dataset.id = n._id;
      
      let href = "#";
      if (n.entityType === "post") {
        href = `/post.html?id=${n.entityId}`;
      } else if (n.entityType === "user") {
        href = `/profile.html`; // View profile page
      }
      
      let snippetHtml = n.contentSnippet ? `<div class="notif-snippet">${esc(n.contentSnippet)}</div>` : "";
      
      // Icon mapping based on type
      let icon = "🔔";
      if (n.type === "comment_reply") icon = "💬";
      else if (n.type === "post_upvote" || n.type === "comment_upvote") icon = "▲";
      else if (n.type === "mention") icon = "🏷️";
      else if (n.type === "follow") icon = "👤";
      else if (n.type === "new_post") icon = "📰";
      
      card.innerHTML = `
        <div class="notif-icon-wrap">${icon}</div>
        <div class="notif-body">
          <div class="notif-title">${esc(n.title)}</div>
          ${snippetHtml}
          <div class="notif-time">${timeAgo(n.createdAt)}</div>
        </div>
        <div class="notif-actions">
          ${n.isRead ? "" : `<button class="btn-read-mark" onclick="event.stopPropagation(); markOneRead('${n._id}')" title="Mark as read">✓</button>`}
        </div>
      `;
      
      card.onclick = async () => {
        if (!n.isRead) {
          try {
            await api(`/notifications/${n._id}/mark-read`, { method: "PATCH" });
          } catch (err) {
            console.error("Failed to mark notification as read", err);
          }
        }
        location.href = href;
      };
      
      feed.appendChild(card);
    });
  } catch (err) {
    toast(err.message, "error");
    if (offset === 0) {
      feed.innerHTML = `<div class="message">${esc(err.message)}</div>`;
    }
  }
}

async function markOneRead(id) {
  try {
    await api(`/notifications/${id}/mark-read`, { method: "PATCH" });
    toast("Marked as read");
    updateUnreadCount();
    offset = 0;
    loadNotifications(false);
  } catch (err) {
    toast(err.message, "error");
  }
}

async function markAllNotificationsRead() {
  try {
    await api("/notifications/mark-all-read", { method: "PATCH" });
    toast("All notifications marked as read");
    updateUnreadCount();
    offset = 0;
    loadNotifications(false);
  } catch (err) {
    toast(err.message, "error");
  }
}

function loadMoreNotifications() {
  if (allLoaded) return;
  offset += limit;
  loadNotifications(false);
}

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return interval + "y ago";
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return interval + "mo ago";
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return interval + "d ago";
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return interval + "h ago";
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return interval + "m ago";
  return seconds < 10 ? "just now" : seconds + "s ago";
}

// Initial load
document.addEventListener("DOMContentLoaded", () => {
  loadNotifications();
});
