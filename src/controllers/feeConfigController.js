const FeeConfig = require('../models/FeeConfig');

const feeConfigController = {
  // Get the latest configuration
  getLatest: async (req, res) => {
    try {
      let config = await FeeConfig.findOne().sort({ createdAt: -1 });
      
      // If no config exists, create a default one
      if (!config) {
        config = new FeeConfig();
        await config.save();
      }
      
      res.status(200).json({ success: true, data: config });
    } catch (error) {
      console.error('Get FeeConfig error:', error);
      res.status(500).json({ message: 'Lỗi server khi lấy cấu hình' });
    }
  },

  // Update the configuration (Admin only)
  updateLatest: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ Admin mới có quyền cập nhật thông báo phí' });
      }
      const { date, courtFee, shuttleFee } = req.body;

      if (!date || !courtFee || !shuttleFee) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ các trường' });
      }

      let config = await FeeConfig.findOne().sort({ createdAt: -1 });
      
      if (!config) {
        config = new FeeConfig({ date, courtFee, shuttleFee });
      } else {
        config.date = date;
        config.courtFee = courtFee;
        config.shuttleFee = shuttleFee;
      }

      await config.save();

      res.status(200).json({ success: true, data: config, message: 'Cập nhật cấu hình thành công' });
    } catch (error) {
      console.error('Update FeeConfig error:', error);
      res.status(500).json({ message: 'Lỗi server khi cập nhật cấu hình' });
    }
  }
};

module.exports = feeConfigController;
