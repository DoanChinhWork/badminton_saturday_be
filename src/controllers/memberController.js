const Member = require('../models/Member');
const { generateMemberCode } = require('../utils/helpers');
const bcrypt = require('bcryptjs');

const memberController = {
  /**
   * GET /api/members
   * Public - Lấy danh sách tất cả thành viên
   */
  getAll: async (req, res) => {
    try {
      const members = await Member.find().sort({ name: 1 });
      res.status(200).json({ success: true, data: members });
    } catch (error) {
      console.error('Get members error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * GET /api/members/:id
   * Public - Lấy thông tin 1 thành viên
   */
  getById: async (req, res) => {
    try {
      const member = await Member.findById(req.params.id);
      if (!member) {
        return res.status(404).json({ message: 'Không tìm thấy thành viên' });
      }
      res.status(200).json({ success: true, data: member });
    } catch (error) {
      console.error('Get member error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * POST /api/members
   * Admin - Thêm thành viên mới
   * Body: { name, memberCode? }
   */
  create: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ Admin mới có quyền thêm thành viên' });
      }
      const { name, memberCode, amountDue, note, username, password, customSpinsPerWeek } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Tên thành viên là bắt buộc' });
      }

      // Auto-generate memberCode from name if not provided
      const code = memberCode ? memberCode.toUpperCase().replace(/\s/g, '') : generateMemberCode(name);

      // Check duplicate memberCode
      const existing = await Member.findOne({ memberCode: code });
      if (existing) {
        return res.status(400).json({ message: `Mã thành viên "${code}" đã tồn tại` });
      }

      // Username checking
      let hashedPw = undefined;
      let finalUsername = undefined;

      if (username) {
        finalUsername = username.toLowerCase();
        const existingUser = await Member.findOne({ username: finalUsername });
        if (existingUser) {
          return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });
        }
      }

      if (password) {
        const salt = await bcrypt.genSalt(10);
        hashedPw = await bcrypt.hash(password, salt);
      }

      const initialAmount = amountDue !== undefined ? Number(amountDue) : 0;
      const initialCustomSpins = (customSpinsPerWeek !== undefined && customSpinsPerWeek !== null && customSpinsPerWeek !== '')
        ? Math.max(1, Number(customSpinsPerWeek))
        : null;
      
      const member = await Member.create({
        name: name.trim(),
        memberCode: code,
        amountDue: initialAmount,
        paymentStatus: initialAmount > 0 ? 'unpaid' : 'paid',
        note: note || '',
        username: finalUsername,
        password: hashedPw,
        customSpinsPerWeek: initialCustomSpins
      });

      res.status(201).json({ success: true, data: member });
    } catch (error) {
      console.error('Create member error:', error);
      if (error.code === 11000) {
        return res.status(400).json({ message: 'Mã thành viên đã tồn tại' });
      }
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * PUT /api/members/:id
   * Admin - Cập nhật thành viên (tên, số tiền, trạng thái)
   * Body: { name?, amountDue?, paymentStatus?, weekLabel? }
   */
  update: async (req, res) => {
    try {
      const { name, amountDue, paymentStatus, weekLabel, memberCode, note, username, password } = req.body;
      const member = await Member.findById(req.params.id);

      if (!member) {
        return res.status(404).json({ message: 'Không tìm thấy thành viên' });
      }

      // Check permission: Admin or Self
      const isSelf = req.user && (req.user.id === member._id.toString());
      const isAdmin = req.user && req.user.role === 'admin';

      if (!isAdmin && !isSelf) {
        return res.status(403).json({ message: 'Bạn không có quyền chỉnh sửa thông tin của thành viên này' });
      }

      if (!isAdmin && (amountDue !== undefined || paymentStatus !== undefined || weekLabel !== undefined)) {
        return res.status(403).json({ message: 'Chỉ Admin mới có quyền cập nhật thông tin tài chính' });
      }

      // Update name and regenerate memberCode if name changed
      if (name && name.trim()) {
        member.name = name.trim();
        if (!memberCode) {
          const newCode = generateMemberCode(name);
          // Check if the new code conflicts with another member
          const existing = await Member.findOne({ memberCode: newCode, _id: { $ne: member._id } });
          if (!existing) {
            member.memberCode = newCode;
          }
        }
      }

      if (memberCode) {
        const code = memberCode.toUpperCase().replace(/\s/g, '');
        const existing = await Member.findOne({ memberCode: code, _id: { $ne: member._id } });
        if (existing) {
          return res.status(400).json({ message: `Mã thành viên "${code}" đã tồn tại` });
        }
        member.memberCode = code;
      }

      // Update amountDue - KEY LOGIC: if amountDue > 0, set status to unpaid
      if (amountDue !== undefined) {
        member.amountDue = Number(amountDue);
        if (Number(amountDue) > 0) {
          member.paymentStatus = 'unpaid';
        } else if (Number(amountDue) === 0) {
          member.paymentStatus = 'paid';
        }
      }

      // Manual status override (if explicitly provided)
      if (paymentStatus && amountDue === undefined) {
        member.paymentStatus = paymentStatus;
      }

      if (weekLabel) {
        member.weekLabel = weekLabel;
      }

      if (note !== undefined) {
        member.note = note;
      }

      // Handle username update
      if (username !== undefined) {
        if (username === '') {
          member.username = undefined; // Or leave it alone, but if admin explicitly clears it?
        } else {
          const finalUsername = username.toLowerCase();
          const existingUser = await Member.findOne({ username: finalUsername, _id: { $ne: member._id } });
          if (existingUser) {
            return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });
          }
          member.username = finalUsername;
        }
      }

      // Handle password update
      if (password) {
        const salt = await bcrypt.genSalt(10);
        member.password = await bcrypt.hash(password, salt);
      }

      // Handle customSpinsPerWeek update
      if (isAdmin && req.body.customSpinsPerWeek !== undefined) {
        const val = req.body.customSpinsPerWeek;
        member.customSpinsPerWeek = (val === '' || val === null) ? null : Math.max(1, Number(val));
      }

      await member.save();
      res.status(200).json({ success: true, data: member });
    } catch (error) {
      console.error('Update member error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * PUT /api/members/bulk-update
   * Admin - Cập nhật amountDue cho nhiều thành viên cùng lúc
   * Body: { amountDue, weekLabel?, memberIds? }
   */
  bulkUpdate: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ Admin mới có quyền cập nhật hàng loạt' });
      }
      const { amountDue, weekLabel, isAdd } = req.body;

      if (amountDue === undefined) {
        return res.status(400).json({ message: 'Số tiền là bắt buộc' });
      }

      let filter = {};
      if (req.body.memberIds && Array.isArray(req.body.memberIds) && req.body.memberIds.length > 0) {
        filter = { _id: { $in: req.body.memberIds } };
      }

      let updateOp;
      if (isAdd) {
        updateOp = [
          {
            $set: {
              amountDue: { $add: ["$amountDue", Number(amountDue)] },
              ...(weekLabel ? { weekLabel: weekLabel } : {})
            }
          },
          {
            $set: {
              paymentStatus: {
                $cond: { if: { $gt: ["$amountDue", 0] }, then: 'unpaid', else: 'paid' }
              }
            }
          }
        ];
      } else {
        updateOp = {
          amountDue: Number(amountDue),
          paymentStatus: Number(amountDue) > 0 ? 'unpaid' : 'paid'
        };
        if (weekLabel) {
          updateOp.weekLabel = weekLabel;
        }
      }

      const result = await Member.updateMany(filter, updateOp);

      res.status(200).json({
        success: true,
        message: `Đã cập nhật ${result.modifiedCount} thành viên`,
        modifiedCount: result.modifiedCount
      });
    } catch (error) {
      console.error('Bulk update error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * DELETE /api/members/:id
   * Admin - Xóa thành viên
   */
  delete: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ Admin mới có quyền xóa thành viên' });
      }
      const member = await Member.findByIdAndDelete(req.params.id);
      if (!member) {
        return res.status(404).json({ message: 'Không tìm thấy thành viên' });
      }
      res.status(200).json({ success: true, message: 'Đã xóa thành viên' });
    } catch (error) {
      console.error('Delete member error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * PUT /api/members/:id/reset-spins
   * Admin - Reset lượt quay cho thành viên
   */
  resetSpins: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ Admin mới có quyền reset lượt quay' });
      }
      const member = await Member.findById(req.params.id);
      if (!member) {
        return res.status(404).json({ message: 'Không tìm thấy thành viên' });
      }

      member.spinCount = 0;
      member.lastSpinDate = null;
      await member.save();

      res.status(200).json({ success: true, data: member, message: 'Đã reset lượt quay thành công' });
    } catch (error) {
      console.error('Reset spins error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  }
};

module.exports = memberController;
