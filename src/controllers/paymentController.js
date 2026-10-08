const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const SpinHistory = require('../models/SpinHistory');
const GameSetting = require('../models/GameSetting');
const config = require('../config');

/**
 * Lucky wheel.
 *
 * The draw happens here, never in the browser, so the odds cannot be rewritten
 * from the console. A win has to be written to `member.amountDue`: the SePay
 * webhook settles a member only when `transferAmount >= member.amountDue`, so a
 * discount that lived only in the UI would make every winner look like they had
 * underpaid and nobody would ever be marked as paid.
 *
 * No voucher is stored. The pre-spin amount is kept in memory only, purely so
 * "tôi không muốn dùng may mắn" can put it back; a server restart simply drops
 * the undo and leaves the member with the discount they already won.
 *
 * `odds: null` means "whatever probability is left over".
 */
const LUCKY_PRIZES = [
  { id: 'turn1', label: '+1 Lượt chơi', short: '+1 Lượt', kind: 'turn', value: 1, odds: 0.18 }, // 18% (Nhiều thứ 2)
  { id: 'cash1', label: '10.000đ', short: '10K', kind: 'cash', value: 10000, odds: 0.01 }, // 1%
  { id: 'cash2', label: '2.000đ', short: '2K', kind: 'cash', value: 2000, odds: 0.10 }, // 10%
  { id: 'cash3', label: '15.000đ', short: '15K', kind: 'cash', value: 15000, odds: 0.001 }, // 0.1% (Jackpot)
  { id: 'cash4', label: '4.000đ', short: '4K', kind: 'cash', value: 4000, odds: 0.035 }, // 3.5%
  { id: 'cash5', label: '5.000đ', short: '5K', kind: 'cash', value: 5000, odds: 0.02 }, // 2%
  { id: 'half', label: 'Giảm 50%', short: '50%', kind: 'percent', value: 50, odds: 0.004 }, // 0.4%
  { id: 'none', label: 'Chúc bạn may mắn lần sau', short: 'Lần sau', kind: 'none', value: 0, odds: null } // 65% (Cao nhất)
];

/** Never discount a bill down to zero — VietQR needs a payable amount. */
const MIN_REMAINING = 1000;

/** The half-price slice is only in play on small bills. */
const HALF_MAX_AMOUNT = 40000;

const isEligible = (prize, amountDue) => prize.id !== 'half' || amountDue <= HALF_MAX_AMOUNT;

/** memberId -> { originalAmountDue, discountedTo, prizeId, discount } */
const activeDraws = new Map();

/**
 * Odds for one particular bill. A prize the bill is not eligible for drops to
 * zero and its share falls through to "chúc bạn may mắn lần sau".
 */
const prizeOdds = (amountDue) => {
  const fixed = LUCKY_PRIZES.reduce(
    (sum, p) => sum + (p.odds && isEligible(p, amountDue) ? p.odds : 0),
    0
  );
  return LUCKY_PRIZES.map((p) => ({
    ...p,
    eligible: isEligible(p, amountDue),
    odds: p.odds === null ? Math.max(0, 1 - fixed) : isEligible(p, amountDue) ? p.odds : 0
  }));
};

const drawPrize = (amountDue) => {
  const table = prizeOdds(amountDue);
  const total = table.reduce((sum, p) => sum + p.odds, 0);
  let roll = Math.random() * total;
  for (const prize of table) {
    roll -= prize.odds;
    if (roll <= 0) return prize;
  }
  return table[table.length - 1];
};

const discountFor = (prize, amountDue) => {
  if (prize.kind === 'none' || prize.kind === 'turn') return 0;
  const raw =
    prize.kind === 'percent'
      ? Math.round((amountDue * prize.value) / 100 / 1000) * 1000
      : prize.value;
  return Math.max(0, Math.min(raw, amountDue - MIN_REMAINING));
};

const buildPayment = (member) => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const dateStr = `${day}${month}${now.getFullYear()}`;
  const transferDescription = `CAULONG ${member.memberCode} ${dateStr}`;

  const bankCode = config.SEPAY.bankCode;
  const bankAccount = config.SEPAY.bankAccount;
  const amount = member.amountDue;

  return {
    bankCode,
    bankAccount,
    bankName: config.SEPAY.bankName,
    accountName: config.SEPAY.accountName,
    amount,
    transferDescription,
    qrUrl:
      `https://img.vietqr.io/image/${bankCode}-${bankAccount}-compact2.png` +
      `?amount=${amount}&addInfo=${encodeURIComponent(transferDescription)}` +
      `&accountName=${encodeURIComponent(config.SEPAY.accountName)}`
  };
};

const publicPrizes = (amountDue) =>
  prizeOdds(amountDue).map(({ id, label, short, kind, value, odds, eligible }) => ({
    id,
    label,
    short,
    kind,
    value,
    odds,
    eligible
  }));

const isSameWeek = (date1, date2) => {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const getMonday = (d) => {
    const day = d.getDay() || 7;
    if (day !== 1) d.setHours(-24 * (day - 1));
    d.setHours(0,0,0,0);
    return d.getTime();
  };
  return getMonday(d1) === getMonday(d2);
};

const GAME_LIST = ['wheel', 'cards', 'boxes'];

const GAME_CATALOG = {
  wheel: {
    id: 'wheel',
    name: 'Vòng quay may mắn',
    tagline: 'Quay vòng may mắn – Nhận ngay giảm giá',
    actionText: 'Quay để thử vận may',
    spinningText: 'Đang quay…',
    bubbleText: 'Hãy tham gia vòng quay may mắn để test nhân phẩm, biết đâu gỡ lại được tiền cước! 🤪🏸'
  },
  cards: {
    id: 'cards',
    name: 'Lật thẻ bài may mắn',
    tagline: 'Lật thẻ nhân phẩm – Thử vận may tuần này',
    actionText: 'Lật thẻ thử vận may',
    spinningText: 'Đang mở thẻ…',
    bubbleText: 'Chọn 1 lá bài may mắn để test nhân phẩm, biết đâu gỡ lại được tiền cước! 🃏🏸'
  },
  boxes: {
    id: 'boxes',
    name: 'Hộp quà bí ẩn',
    tagline: 'Mở hộp quà bí mật – Rinh quà bất ngờ',
    actionText: 'Mở hộp thử vận may',
    spinningText: 'Đang mở hộp…',
    bubbleText: 'Mở 1 hộp quà may mắn để test nhân phẩm, biết đâu gỡ lại được tiền cước! 🎁🏸'
  }
};

const getWeekNumber = (date = new Date()) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

const resolveActiveGame = async () => {
  try {
    let setting = await GameSetting.findOne();
    if (!setting) {
      setting = await GameSetting.create({ mode: 'auto', manualGame: 'wheel', spinsPerWeek: 1 });
    }
    const weekNo = getWeekNumber(new Date());
    const autoGame = GAME_LIST[weekNo % 3];
    const activeGame = setting.mode === 'manual' ? setting.manualGame : autoGame;
    return {
      mode: setting.mode,
      manualGame: setting.manualGame,
      spinsPerWeek: setting.spinsPerWeek || 1,
      activeGame,
      weekNo,
      gameInfo: GAME_CATALOG[activeGame] || GAME_CATALOG.wheel
    };
  } catch (err) {
    console.error('resolveActiveGame error:', err);
    return {
      mode: 'auto',
      manualGame: 'wheel',
      spinsPerWeek: 1,
      activeGame: 'wheel',
      weekNo: 1,
      gameInfo: GAME_CATALOG.wheel
    };
  }
};

const paymentController = {
  /**
   * GET /api/payments/qr/:memberId
   * Public - Trả thông tin tạo QR VietQR cho thành viên
   */
  getQRInfo: async (req, res) => {
    try {
      const member = await Member.findById(req.params.memberId);
      if (!member) {
        return res.status(404).json({ message: 'Không tìm thấy thành viên' });
      }

      if (member.paymentStatus === 'paid' || member.amountDue <= 0) {
        return res.status(400).json({ message: 'Thành viên này đã thanh toán' });
      }

      const draw = activeDraws.get(String(member._id));
      const baseAmount = draw?.originalAmountDue || member.amountDue;
      const gameData = await resolveActiveGame();

      const now = new Date();
      if (!member.lastSpinDate || !isSameWeek(member.lastSpinDate, now)) {
        member.spinCount = 0;
      }
      const maxSpins = member.customSpinsPerWeek || gameData.spinsPerWeek || 1;
      const spinCount = member.spinCount || 0;
      const remainingSpins = Math.max(0, maxSpins - spinCount);

      res.status(200).json({
        success: true,
        data: {
          member: {
            id: member._id,
            name: member.name,
            memberCode: member.memberCode,
            amountDue: member.amountDue
          },
          payment: buildPayment(member),
          lucky: {
            gameType: draw?.gameType || gameData.activeGame,
            gameInfo: GAME_CATALOG[draw?.gameType || gameData.activeGame] || gameData.gameInfo,
            weekNo: gameData.weekNo,
            mode: gameData.mode,
            maxSpins,
            spinCount,
            remainingSpins,
            prizes: publicPrizes(baseAmount),
            halfMaxAmount: HALF_MAX_AMOUNT,
            spun: Boolean(spinCount >= maxSpins),
            cancelled: Boolean(draw && draw.cancelled),
            result:
              draw && !draw.cancelled
                ? { prizeId: draw.prizeId, discount: draw.discount, originalAmountDue: draw.originalAmountDue }
                : null
          }
        }
      });
    } catch (error) {
      console.error('Get QR info error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * POST /api/payments/lucky-spin/:memberId
   * Public - Quay vòng may mắn (chế độ test: mở quay vô hạn lượt).
   */
  luckySpin: async (req, res) => {
    try {
      const member = await Member.findById(req.params.memberId);
      if (!member) {
        return res.status(404).json({ message: 'Không tìm thấy thành viên' });
      }
      if (member.paymentStatus === 'paid' || member.amountDue <= 0) {
        return res.status(400).json({ message: 'Thành viên này đã thanh toán' });
      }

      const key = String(member._id);

      const now = new Date();
      if (!member.lastSpinDate || !isSameWeek(member.lastSpinDate, now)) {
        member.spinCount = 0;
      }

      const gameData = await resolveActiveGame();
      const maxSpins = member.customSpinsPerWeek || gameData.spinsPerWeek || 1;

      if (member.spinCount >= maxSpins) {
        return res.status(200).json({
          success: true,
          data: {
            outOfTurns: true,
            maxSpins,
            spinCount: member.spinCount
          }
        });
      }

      member.spinCount += 1;
      member.lastSpinDate = now;

      // Giữ nguyên số tiền gốc (originalAmountDue) để tính toán giải thưởng mới mỗi lần quay
      const existing = activeDraws.get(key);
      const originalAmountDue = existing?.originalAmountDue || member.amountDue;

      if (originalAmountDue > 150000) {
        // Rollback spin count if they can't actually spin
        member.spinCount -= 1;
        return res.status(200).json({
          success: true,
          data: {
            amountTooHigh: true
          }
        });
      }

      const chosenGame = req.body?.gameType && ['wheel', 'cards', 'boxes'].includes(req.body.gameType)
        ? req.body.gameType
        : gameData.activeGame;

      const prize = drawPrize(originalAmountDue);
      const discount = discountFor(prize, originalAmountDue);

      if (prize.kind === 'turn') {
        // Tặng thêm 1 lượt chơi: hoàn lại 1 lượt quay cho thành viên
        member.spinCount = Math.max(0, member.spinCount - 1);
      }

      member.amountDue = Math.max(MIN_REMAINING, originalAmountDue - discount);
      await member.save();

      const history = await SpinHistory.create({
        memberId: member._id,
        memberName: member.name,
        memberCode: member.memberCode,
        prizeId: prize.id,
        prizeLabel: prize.label,
        discount,
        gameType: chosenGame
      });

      activeDraws.set(key, {
        prizeId: prize.id,
        discount,
        originalAmountDue,
        discountedTo: member.amountDue,
        cancelled: false,
        historyId: history._id,
        gameType: chosenGame
      });

      return res.status(200).json({
        success: true,
        data: {
          prizeId: prize.id,
          prizeLabel: prize.label,
          prizeKind: prize.kind,
          discount,
          originalAmountDue,
          gameType: chosenGame,
          maxSpins,
          spinCount: member.spinCount,
          remainingSpins: Math.max(0, maxSpins - member.spinCount),
          member: { id: member._id, amountDue: member.amountDue },
          payment: buildPayment(member)
        }
      });
    } catch (error) {
      console.error('Lucky spin error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * POST /api/payments/lucky-cancel/:memberId
   * Public - Bỏ kết quả vòng quay, trả lại số tiền ban đầu.
   */
  luckyCancel: async (req, res) => {
    try {
      const member = await Member.findById(req.params.memberId);
      if (!member) {
        return res.status(404).json({ message: 'Không tìm thấy thành viên' });
      }

      const key = String(member._id);
      const draw = activeDraws.get(key);
      if (!draw) {
        return res.status(400).json({ message: 'Chưa có kết quả quay nào để hoàn lại' });
      }

      if (draw.cancelled) {
        return res.status(400).json({ message: 'Kết quả quay đã được hoàn lại rồi' });
      }

      // If an admin edited the amount after the spin, their value wins —
      // restoring the stale original would silently undo their change.
      if (draw.discount > 0 && member.amountDue === draw.discountedTo) {
        member.amountDue = draw.originalAmountDue;
        await member.save();
      }
      
      if (draw.historyId) {
        await SpinHistory.findByIdAndUpdate(draw.historyId, { status: 'cancelled' });
      }
      
      // Kept rather than deleted, so the spin stays used up.
      activeDraws.set(key, { ...draw, cancelled: true });

      return res.status(200).json({
        success: true,
        data: {
          cancelled: true,
          member: { id: member._id, amountDue: member.amountDue },
          payment: buildPayment(member)
        }
      });
    } catch (error) {
      console.error('Lucky cancel error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * POST /api/payments/sepay-webhook
   * SePay Webhook - Nhận thông báo khi có giao dịch
   * 
   * SePay payload example:
   * {
   *   "id": 93166,
   *   "gateway": "MBBank",
   *   "transactionDate": "2024-07-15 10:20:30",
   *   "accountNumber": "0962470964046722",
   *   "code": null,
   *   "content": "CAULONG DUYCHINH chuyen tien cau ngay 15/07/2024",
   *   "transferType": "in",
   *   "transferAmount": 50000,
   *   "accumulated": 500000,
   *   "subAccount": null,
   *   "referenceCode": "FT24197xxxx",
   *   "description": ""
   * }
   */
  sepayWebhook: async (req, res) => {
    try {
      const data = req.body;

      // Xác thực API Key từ SePay
      const authHeader = req.headers['authorization'];
      const apiKey = config.SEPAY.apiKey;

      if (apiKey && (!authHeader || !authHeader.includes(apiKey))) {
        console.warn('⚠️ SePay Webhook: Unauthorized. API Key mismatch.');
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      console.log('📥 SePay Webhook received:', JSON.stringify(data, null, 2));

      const {
        id: sepayId,
        gateway,
        transactionDate,
        content,
        transferType,
        transferAmount,
        referenceCode
      } = data;

      // Only process incoming transfers
      if (transferType && transferType !== 'in') {
        console.log('⏭️ Skipping non-incoming transfer');
        return res.status(200).json({ success: true, message: 'Not an incoming transfer' });
      }

      // Prevent duplicate processing
      if (sepayId) {
        const existingTx = await Transaction.findOne({ sepayTransactionId: String(sepayId) });
        if (existingTx) {
          console.log('⏭️ Duplicate webhook, already processed:', sepayId);
          return res.status(200).json({ success: true, message: 'Already processed' });
        }
      }

      // Extract memberCode from content using regex
      // Pattern: "CAULONG MEMBERCODE ..." allowing optional spaces and underscores
      const match = content ? content.match(/CAULONG\s*([A-Za-z0-9_]+)/i) : null;

      let member = null;
      let memberCode = '';

      if (match) {
        memberCode = match[1].toUpperCase();
        console.log('🔍 Extracted memberCode:', memberCode);

        // 1. Try exact match first
        member = await Member.findOne({ memberCode });

        // 2. Fuzzy matching if exact match fails
        if (!member) {
          const allMembers = await Member.find({});
          
          // Normalize function: remove underscores and spaces, uppercase
          const normalize = (str) => str.replace(/[_ ]/g, '').toUpperCase();
          const normalizedExtracted = normalize(memberCode);

          // Try to find exact match on normalized codes
          let matchedMembers = allMembers.filter(m => normalize(m.memberCode) === normalizedExtracted);

          // If still no match, try prefix matching (in case of truncation)
          if (matchedMembers.length === 0) {
            matchedMembers = allMembers.filter(m => {
              const normDB = normalize(m.memberCode);
              // extracted is a prefix of DB, or DB is a prefix of extracted
              return normDB.startsWith(normalizedExtracted) || normalizedExtracted.startsWith(normDB);
            });
          }

          if (matchedMembers.length === 1) {
            member = matchedMembers[0];
            console.log(`✅ Fuzzy matched ${memberCode} to ${member.memberCode}`);
            // Use the real member code from DB for logging
            memberCode = member.memberCode; 
          } else if (matchedMembers.length > 1) {
            console.log(`⚠️ Multiple fuzzy matches found for ${memberCode}, cannot determine exact member.`);
          }
        }
      }

      if (!member) {
        console.log('⚠️ No matching member found for content:', content);
        await Transaction.create({
          memberCode: memberCode || '',
          amount: transferAmount,
          transactionContent: content || '',
          sepayTransactionId: String(sepayId || ''),
          gateway: gateway || '',
          transactionDate: transactionDate || '',
          referenceCode: referenceCode || '',
          status: 'unmatched'
        });
        return res.status(200).json({ success: true, message: 'No matching content or member' });
      }

      // Check if payment amount is sufficient
      const amount = parseFloat(transferAmount);

      // Save transaction log
      const transaction = await Transaction.create({
        memberId: member._id,
        memberCode,
        amount,
        transactionContent: content,
        sepayTransactionId: String(sepayId || ''),
        gateway: gateway || '',
        transactionDate: transactionDate || '',
        referenceCode: referenceCode || '',
        status: 'success',
        matchedAmountDue: member.amountDue
      });

      // Update member payment status if amount is sufficient
      if (amount >= member.amountDue) {
        member.amountDue = 0;
        member.paymentStatus = 'paid';
        await member.save();
        // The bill is settled, so the spin can no longer be undone and the
        // member is free to play again next session.
        activeDraws.delete(String(member._id));
        console.log(`✅ Member ${member.name} (${memberCode}) marked as PAID`);
      } else {
        // Partial payment - reduce the amount due
        member.amountDue = member.amountDue - amount;
        await member.save();
        console.log(`⚠️ Partial payment for ${member.name}: paid ${amount}, remaining ${member.amountDue}`);
      }

      return res.status(200).json({ success: true, message: 'Webhook processed successfully' });

    } catch (error) {
      console.error('❌ SePay Webhook Error:', error);
      // Always return 200 to SePay to prevent retries
      return res.status(200).json({ success: false, message: 'Internal error' });
    }
  },

  /**
   * GET /api/payments/transactions
   * Admin - Lấy lịch sử giao dịch
   */
  getTransactions: async (req, res) => {
    try {
      const { page = 1, limit = 50, month, year, search } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      let query = {};

      // If requested by a normal user, restrict to their own transactions
      if (req.user && req.user.role === 'user') {
        query.memberId = req.user.id;
      }

      if (month && year) {
        const startDate = new Date(year, parseInt(month) - 1, 1);
        const endDate = new Date(year, parseInt(month), 0, 23, 59, 59, 999);
        query.createdAt = {
          $gte: startDate,
          $lte: endDate
        };
      } else if (year) {
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
        query.createdAt = {
          $gte: startDate,
          $lte: endDate
        };
      }

      if (search) {
        const members = await Member.find({
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { memberCode: { $regex: search, $options: 'i' } }
          ]
        }).select('_id');
        
        const memberIds = members.map(m => m._id);
        
        if (memberIds.length > 0) {
          query.memberId = { $in: memberIds };
        } else {
          query.transactionContent = { $regex: search, $options: 'i' };
        }
      }

      const [transactions, total, allTx] = await Promise.all([
        Transaction.find(query)
          .populate('memberId', 'name memberCode avatarUrl')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Transaction.countDocuments(query),
        Transaction.find(query).select('amount')
      ]);

      const totalAmount = allTx.reduce((sum, tx) => sum + tx.amount, 0);

      res.status(200).json({
        success: true,
        data: transactions,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        },
        summary: {
          totalAmount
        }
      });
    } catch (error) {
      console.error('Get transactions error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * GET /api/payments/spin-history
   * Lấy lịch sử quay trúng thưởng
   */
  getSpinHistory: async (req, res) => {
    try {
      const { page = 1, limit = 50, day, month, year, search, prizeId } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Trả về cả các lượt quay "Chúc bạn may mắn lần sau" (discount = 0)
      let query = { status: 'applied' };

      if (req.user && req.user.role === 'user') {
        query.memberId = req.user.id;
      }

      if (year && month && day) {
        const startDate = new Date(year, parseInt(month) - 1, parseInt(day));
        const endDate = new Date(year, parseInt(month) - 1, parseInt(day), 23, 59, 59, 999);
        query.createdAt = { $gte: startDate, $lte: endDate };
      } else if (year && month) {
        const startDate = new Date(year, parseInt(month) - 1, 1);
        const endDate = new Date(year, parseInt(month), 0, 23, 59, 59, 999);
        query.createdAt = { $gte: startDate, $lte: endDate };
      } else if (year) {
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
        query.createdAt = { $gte: startDate, $lte: endDate };
      }

      if (prizeId) {
        query.prizeId = prizeId;
      }

      if (search) {
        query.$or = [
          { memberName: { $regex: search, $options: 'i' } },
          { memberCode: { $regex: search, $options: 'i' } }
        ];
      }

      const [history, total, allWins] = await Promise.all([
        SpinHistory.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).populate('memberId', 'avatarUrl'),
        SpinHistory.countDocuments(query),
        SpinHistory.find(query).select('discount')
      ]);

      const totalDiscount = allWins.reduce((sum, h) => sum + h.discount, 0);

      res.status(200).json({
        success: true,
        data: history,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        },
        summary: {
          totalDiscount
        }
      });
    } catch (error) {
      console.error('Get spin history error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * DELETE /api/payments/spin-history/:id
   * Admin xoá lịch sử quay thưởng
   */
  deleteSpinHistory: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Không có quyền truy cập' });
      }
      const { id } = req.params;
      await SpinHistory.findByIdAndDelete(id);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error('Delete spin history error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * GET /api/payments/game-setting
   * Public/Admin - Lấy thông tin trò chơi hiện tại và cấu hình
   */
  getGameSetting: async (req, res) => {
    try {
      const gameData = await resolveActiveGame();
      res.status(200).json({
        success: true,
        data: {
          mode: gameData.mode,
          manualGame: gameData.manualGame,
          spinsPerWeek: gameData.spinsPerWeek,
          activeGame: gameData.activeGame,
          weekNo: gameData.weekNo,
          gameInfo: gameData.gameInfo,
          games: Object.values(GAME_CATALOG)
        }
      });
    } catch (error) {
      console.error('Get game setting error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  /**
   * PUT /api/payments/game-setting
   * Admin - Cập nhật chế độ xoay tua (auto/manual), trò chơi thủ công, và số lần chơi 1 tuần
   */
  updateGameSetting: async (req, res) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Không có quyền truy cập' });
      }
      const { mode, manualGame, spinsPerWeek } = req.body;
      if (mode && !['auto', 'manual'].includes(mode)) {
        return res.status(400).json({ message: 'Chế độ không hợp lệ (auto hoặc manual)' });
      }
      if (manualGame && !GAME_LIST.includes(manualGame)) {
        return res.status(400).json({ message: 'Trò chơi không hợp lệ' });
      }
      if (spinsPerWeek !== undefined) {
        const num = Number(spinsPerWeek);
        if (isNaN(num) || num < 1) {
          return res.status(400).json({ message: 'Số lượt chơi mỗi tuần phải là số từ 1 trở lên' });
        }
      }

      let setting = await GameSetting.findOne();
      if (!setting) {
        setting = new GameSetting();
      }
      if (mode) setting.mode = mode;
      if (manualGame) setting.manualGame = manualGame;
      if (spinsPerWeek !== undefined) {
        setting.spinsPerWeek = Math.floor(Number(spinsPerWeek));
      }
      await setting.save();

      const gameData = await resolveActiveGame();
      res.status(200).json({
        success: true,
        data: {
          mode: gameData.mode,
          manualGame: gameData.manualGame,
          spinsPerWeek: gameData.spinsPerWeek,
          activeGame: gameData.activeGame,
          weekNo: gameData.weekNo,
          gameInfo: gameData.gameInfo,
          games: Object.values(GAME_CATALOG)
        }
      });
    } catch (error) {
      console.error('Update game setting error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  }
};

module.exports = paymentController;
