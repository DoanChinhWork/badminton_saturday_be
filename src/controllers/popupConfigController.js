const PopupConfig = require('../models/PopupConfig');

const DEFAULTS = { isActive: true, startAt: null, endAt: null, postId: '' };

// Decide on the server so a wrong device clock cannot show or hide the popup
const computeStatus = (cfg, now = new Date()) => {
  if (!cfg.isActive) return 'disabled';
  if (cfg.startAt && now < cfg.startAt) return 'scheduled';
  if (cfg.endAt && now > cfg.endAt) return 'expired';
  return 'live';
};

const serialize = (doc) => {
  const cfg = doc
    ? { isActive: doc.isActive, startAt: doc.startAt, endAt: doc.endAt, postId: doc.postId || '' }
    : DEFAULTS;
  const status = computeStatus(cfg);
  return { ...cfg, status, visible: status === 'live' };
};

// Accept a bare ObjectId or a pasted link such as https://site/news?post=<id>
const extractPostId = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/[a-f0-9]{24}/i);
  return match ? match[0].toLowerCase() : null;
};

const parseDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const popupConfigController = {
  // GET /api/popup-config  (public)
  get: async (req, res) => {
    try {
      const doc = await PopupConfig.findOne().sort({ createdAt: -1 });
      res.status(200).json({ success: true, data: serialize(doc) });
    } catch (error) {
      console.error('Get popup config error:', error);
      res.status(500).json({ message: 'Lỗi server khi lấy cấu hình popup' });
    }
  },

  // PUT /api/popup-config  (admin)
  update: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ Admin mới có quyền cập nhật popup' });
      }

      const { isActive, startAt, endAt, postId } = req.body;

      const start = parseDate(startAt);
      const end = parseDate(endAt);
      if (start === undefined || end === undefined) {
        return res.status(400).json({ message: 'Thời gian không hợp lệ' });
      }
      if (start && end && end <= start) {
        return res.status(400).json({ message: 'Thời gian kết thúc phải sau thời gian bắt đầu' });
      }

      const id = extractPostId(postId);
      if (id === null) {
        return res.status(400).json({ message: 'ID bài viết không hợp lệ (cần 24 ký tự hex hoặc link ?post=...)' });
      }

      let doc = await PopupConfig.findOne().sort({ createdAt: -1 });
      if (!doc) doc = new PopupConfig();
      doc.isActive = Boolean(isActive);
      doc.startAt = start;
      doc.endAt = end;
      doc.postId = id;
      await doc.save();

      res.status(200).json({ success: true, data: serialize(doc), message: 'Đã lưu cấu hình popup' });
    } catch (error) {
      console.error('Update popup config error:', error);
      res.status(500).json({ message: 'Lỗi server khi cập nhật cấu hình popup' });
    }
  }
};

module.exports = popupConfigController;
