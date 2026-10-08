const Tournament = require('../models/Tournament');
const Member = require('../models/Member');

const DEFAULT_TEAM_NAMES = [
  'Đôi Song Sát', 'Đôi Sát Thủ', 'Đôi Vô Địch', 'Đôi Phượng Hoàng', 
  'Đôi Sấm Sét', 'Đôi Thần Tốc', 'Đôi Rồng Lửa', 'Đôi Bão Táp'
];

const calculateStandings = (tournament) => {
  const standingsMap = {};

  (tournament.teams || []).forEach(team => {
    standingsMap[team._id.toString()] = {
      teamId: team._id,
      name: team.name,
      players: team.players,
      played: 0,
      wins: 0,
      losses: 0,
      pointsScored: 0,
      pointsConceded: 0,
      scoreDiff: 0,
      points: 0
    };
  });

  (tournament.matches || []).forEach(match => {
    if (match.stage === 'group' && match.status === 'completed' && match.teamA && match.teamB) {
      const tA = standingsMap[match.teamA.toString()];
      const tB = standingsMap[match.teamB.toString()];

      if (tA && tB) {
        tA.played += 1;
        tB.played += 1;

        tA.pointsScored += match.scoreA;
        tA.pointsConceded += match.scoreB;

        tB.pointsScored += match.scoreB;
        tB.pointsConceded += match.scoreA;

        if (match.scoreA > match.scoreB) {
          tA.wins += 1;
          tA.points += 3;
          tB.losses += 1;
        } else if (match.scoreB > match.scoreA) {
          tB.wins += 1;
          tB.points += 3;
          tA.losses += 1;
        }
      }
    }
  });

  const standings = Object.values(standingsMap).map(t => {
    t.scoreDiff = t.pointsScored - t.pointsConceded;
    return t;
  });

  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.scoreDiff !== a.scoreDiff) return b.scoreDiff - a.scoreDiff;
    return b.pointsScored - a.pointsScored;
  });

  return standings;
};

const summarizeSeason = (t) => {
  const finalMatch = (t.matches || []).find(m => m.stage === 'final' && m.status === 'completed' && m.winner);
  let championPlayers = [];
  if (finalMatch) {
    const winningTeam = (t.teams || []).find(
      team =>
        (finalMatch.winnerTeamId && team._id.toString() === finalMatch.winnerTeamId.toString()) ||
        team.name === finalMatch.winner
    );
    if (winningTeam && winningTeam.players) {
      championPlayers = winningTeam.players.map(p => p.name).filter(Boolean);
    }
  }

  return {
    _id: t._id,
    title: t.title || 'Giải Cầu Lông Sát Thủ',
    season: t.season || 'Season 1',
    isActive: !!t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    teamCount: (t.teams || []).length,
    matchCount: (t.matches || []).length,
    completedCount: (t.matches || []).filter(m => m.status === 'completed').length,
    champion: finalMatch ? finalMatch.winner : null,
    championPlayers
  };
};

const resolveTargetTournament = async (req) => {
  const targetId = req.query?.tournamentId || req.body?.tournamentId;
  if (targetId) {
    const byId = await Tournament.findById(targetId);
    if (byId) return byId;
  }
  let active = await Tournament.findOne({ isActive: true }).sort({ createdAt: -1 });
  if (!active) {
    active = await Tournament.findOne().sort({ createdAt: -1 });
  }
  return active;
};

const tournamentController = {
  // GET /api/tournament?tournamentId=...
  getTournament: async (req, res) => {
    try {
      let allTournaments = await Tournament.find()
        .sort({ createdAt: -1 })
        .populate({
          path: 'teams.players',
          select: 'name avatarUrl memberCode username'
        });

      if (allTournaments.length === 0) {
        const initial = new Tournament({
          title: 'Giải Cầu Lông Sát Thủ',
          season: 'Season 1',
          isActive: true,
          teams: [],
          matches: []
        });
        await initial.save();
        allTournaments = [initial];
      }

      const { tournamentId } = req.query;
      let tournament = null;

      if (tournamentId) {
        tournament = allTournaments.find(t => t._id.toString() === tournamentId.toString());
      }
      if (!tournament) {
        tournament = allTournaments.find(t => t.isActive) || allTournaments[0];
      }

      const standings = calculateStandings(tournament);
      const seasons = allTournaments.map(summarizeSeason);

      res.status(200).json({
        success: true,
        data: {
          tournament,
          standings,
          seasons
        }
      });
    } catch (error) {
      console.error('Get tournament error:', error);
      res.status(500).json({ message: 'Lỗi server khi lấy thông tin giải đấu' });
    }
  },

  // POST /api/tournament/seasons (Admin)
  // Archives current active season (keeping all its data intact) and creates a new active season
  createSeason: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền tạo mùa giải mới' });
      }

      const count = await Tournament.countDocuments();
      const { season, title } = req.body;

      // If previous active tournament still has placeholder name 'Season Mới', rename it to 'Season 1'
      await Tournament.updateMany(
        { season: 'Season Mới' },
        { $set: { season: 'Season 1' } }
      );

      // Archive all existing seasons
      await Tournament.updateMany({}, { $set: { isActive: false } });

      const newSeasonName = (season && season.trim()) ? season.trim() : `Season ${count + 1}`;
      const newTitle = (title && title.trim()) ? title.trim() : 'Giải Cầu Lông Sát Thủ';

      const newTournament = new Tournament({
        title: newTitle,
        season: newSeasonName,
        isActive: true,
        teams: [],
        matches: []
      });
      await newTournament.save();

      res.status(201).json({
        success: true,
        message: `Đã lưu mùa giải trước vào lịch sử và khởi tạo "${newSeasonName}" thành công!`,
        tournament: newTournament
      });
    } catch (error) {
      console.error('Create season error:', error);
      res.status(500).json({ message: 'Lỗi server khi tạo mùa giải mới' });
    }
  },

  // PUT /api/tournament/seasons/:id (Admin)
  // Update season name, title, or set as active season
  updateSeasonInfo: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền chỉnh sửa mùa giải' });
      }

      const { id } = req.params;
      const { season, title, isActive } = req.body;

      const tournament = await Tournament.findById(id);
      if (!tournament) {
        return res.status(404).json({ message: 'Không tìm thấy mùa giải' });
      }

      if (season && season.trim()) {
        tournament.season = season.trim();
      }
      if (title && title.trim()) {
        tournament.title = title.trim();
      }

      if (isActive === true) {
        await Tournament.updateMany({ _id: { $ne: tournament._id } }, { $set: { isActive: false } });
        tournament.isActive = true;
      }

      await tournament.save();

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật thông tin mùa giải',
        tournament
      });
    } catch (error) {
      console.error('Update season info error:', error);
      res.status(500).json({ message: 'Lỗi server khi cập nhật mùa giải' });
    }
  },

  // DELETE /api/tournament/seasons/:id (Admin)
  deleteSeason: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền xóa mùa giải' });
      }

      const { id } = req.params;
      const total = await Tournament.countDocuments();
      if (total <= 1) {
        return res.status(400).json({ message: 'Không thể xóa mùa giải duy nhất hiện có' });
      }

      const deleted = await Tournament.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ message: 'Không tìm thấy mùa giải' });
      }

      if (deleted.isActive) {
        const latest = await Tournament.findOne().sort({ createdAt: -1 });
        if (latest) {
          latest.isActive = true;
          await latest.save();
        }
      }

      res.status(200).json({
        success: true,
        message: `Đã xóa mùa giải "${deleted.season}"`
      });
    } catch (error) {
      console.error('Delete season error:', error);
      res.status(500).json({ message: 'Lỗi server khi xóa mùa giải' });
    }
  },

  // POST /api/tournament/pair-teams (Admin)
  // Body: { memberIds: [], tournamentId? }
  pairTeamsRandomly: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền chia cặp' });
      }

      const { memberIds } = req.body;
      if (!memberIds || !Array.isArray(memberIds) || memberIds.length < 2) {
        return res.status(400).json({ message: 'Vui lòng chọn ít nhất 2 thành viên' });
      }

      const members = await Member.find({ _id: { $in: memberIds } });

      const shuffled = [...members];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      const newTeams = [];
      let nameIndex = 0;

      for (let i = 0; i < shuffled.length; i += 2) {
        const teamPlayers = [shuffled[i]._id];
        if (i + 1 < shuffled.length) {
          teamPlayers.push(shuffled[i + 1]._id);
        }

        const teamName = DEFAULT_TEAM_NAMES[nameIndex] || `Đội ${nameIndex + 1}`;
        nameIndex++;

        newTeams.push({
          name: teamName,
          players: teamPlayers
        });
      }

      let tournament = await resolveTargetTournament(req);
      if (!tournament) {
        tournament = new Tournament({ isActive: true, season: 'Season 1' });
      }

      tournament.teams = newTeams;
      tournament.matches = [];
      await tournament.save();

      await tournament.populate({
        path: 'teams.players',
        select: 'name avatarUrl memberCode username'
      });

      res.status(200).json({
        success: true,
        message: `Đã chia thành công ${newTeams.length} cặp đấu ngẫu nhiên`,
        teams: tournament.teams,
        tournament
      });
    } catch (error) {
      console.error('Pair teams error:', error);
      res.status(500).json({ message: 'Lỗi server khi chia cặp' });
    }
  },

  // PUT /api/tournament/teams (Admin)
  // Body: { teams: [{ _id?, name, players: [] }], tournamentId? }
  updateTeams: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền sửa danh sách cặp đấu' });
      }

      const { teams } = req.body;
      let tournament = await resolveTargetTournament(req);
      if (!tournament) {
        return res.status(404).json({ message: 'Không tìm thấy giải đấu' });
      }

      // Map old team _id -> old name before updating
      const oldNameById = {};
      (tournament.teams || []).forEach(t => {
        if (t._id) oldNameById[t._id.toString()] = t.name;
      });

      // Normalize players array (support both ID strings and populated objects)
      const normalizedTeams = (teams || []).map((t, idx) => {
        const cleanPlayers = (t.players || [])
          .map(p => (p && typeof p === 'object' ? p._id : p))
          .filter(Boolean);
        return {
          ...(t._id ? { _id: t._id } : {}),
          name: (t.name && t.name.trim()) ? t.name.trim() : `Đội ${idx + 1}`,
          players: cleanPlayers
        };
      });

      tournament.teams = normalizedTeams;

      // Sync updated team names into existing matches
      const newNameById = {};
      const newNameByOldName = {};
      (tournament.teams || []).forEach(t => {
        if (t._id) {
          const idStr = t._id.toString();
          newNameById[idStr] = t.name;
          if (oldNameById[idStr] && oldNameById[idStr] !== t.name) {
            newNameByOldName[oldNameById[idStr]] = t.name;
          }
        }
      });

      if (tournament.matches && tournament.matches.length > 0) {
        tournament.matches.forEach(m => {
          if (m.teamA && newNameById[m.teamA.toString()]) {
            m.teamAName = newNameById[m.teamA.toString()];
          } else if (m.teamAName && newNameByOldName[m.teamAName]) {
            m.teamAName = newNameByOldName[m.teamAName];
          }

          if (m.teamB && newNameById[m.teamB.toString()]) {
            m.teamBName = newNameById[m.teamB.toString()];
          } else if (m.teamBName && newNameByOldName[m.teamBName]) {
            m.teamBName = newNameByOldName[m.teamBName];
          }

          if (m.status === 'completed') {
            if (m.scoreA > m.scoreB) m.winner = m.teamAName;
            else if (m.scoreB > m.scoreA) m.winner = m.teamBName;
          }
        });
      }

      await tournament.save();
      await tournament.populate({
        path: 'teams.players',
        select: 'name avatarUrl memberCode username'
      });

      res.status(200).json({
        success: true,
        message: 'Đã cập nhật tên đội và thành viên thành công',
        teams: tournament.teams,
        tournament
      });
    } catch (error) {
      console.error('Update teams error:', error);
      res.status(500).json({ message: 'Lỗi server' });
    }
  },

  // POST /api/tournament/generate-schedule (Admin)
  generateGroupSchedule: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền tạo lịch thi đấu' });
      }

      let tournament = await resolveTargetTournament(req);
      if (!tournament || tournament.teams.length < 2) {
        return res.status(400).json({ message: 'Cần ít nhất 2 đội để tạo lịch thi đấu' });
      }

      const teams = tournament.teams;
      const groupMatches = [];
      let roundCount = 1;

      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          groupMatches.push({
            stage: 'group',
            round: roundCount++,
            teamA: teams[i]._id,
            teamB: teams[j]._id,
            teamAName: teams[i].name,
            teamBName: teams[j].name,
            scoreA: 0,
            scoreB: 0,
            status: 'scheduled'
          });
        }
      }

      const knockoutMatches = tournament.matches.filter(m => m.stage !== 'group');
      tournament.matches = [...groupMatches, ...knockoutMatches];

      await tournament.save();

      res.status(200).json({
        success: true,
        message: `Đã tạo thành công ${groupMatches.length} trận đấu vòng bảng (Vòng tròn 1 lượt)`,
        tournament
      });
    } catch (error) {
      console.error('Generate schedule error:', error);
      res.status(500).json({ message: 'Lỗi server khi tạo lịch thi đấu' });
    }
  },

  // POST /api/tournament/setup-knockout (Admin)
  setupKnockout: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền thiết lập vòng Knockout' });
      }

      const { semi1TeamA, semi1TeamB, semi2TeamA, semi2TeamB } = req.body;
      let tournament = await resolveTargetTournament(req);

      if (!tournament) {
        return res.status(404).json({ message: 'Không tìm thấy giải đấu' });
      }

      tournament.matches = tournament.matches.filter(m => m.stage === 'group');

      const finalMatch = {
        stage: 'final',
        teamAName: 'Thắng Bán Kết 1',
        teamBName: 'Thắng Bán Kết 2',
        scoreA: 0,
        scoreB: 0,
        status: 'scheduled'
      };

      tournament.matches.push(finalMatch);
      const savedFinal = tournament.matches[tournament.matches.length - 1];

      const getTeamObj = (id) => tournament.teams.id(id);

      const tS1A = getTeamObj(semi1TeamA);
      const tS1B = getTeamObj(semi1TeamB);
      const tS2A = getTeamObj(semi2TeamA);
      const tS2B = getTeamObj(semi2TeamB);

      const semi1 = {
        stage: 'semi_final',
        round: 1,
        teamA: tS1A ? tS1A._id : null,
        teamB: tS1B ? tS1B._id : null,
        teamAName: tS1A ? tS1A.name : 'Đội Bán Kết 1A',
        teamBName: tS1B ? tS1B.name : 'Đội Bán Kết 1B',
        scoreA: 0,
        scoreB: 0,
        status: 'scheduled',
        nextMatchId: savedFinal._id,
        nextMatchSlot: 'teamA'
      };

      const semi2 = {
        stage: 'semi_final',
        round: 2,
        teamA: tS2A ? tS2A._id : null,
        teamB: tS2B ? tS2B._id : null,
        teamAName: tS2A ? tS2A.name : 'Đội Bán Kết 2A',
        teamBName: tS2B ? tS2B.name : 'Đội Bán Kết 2B',
        scoreA: 0,
        scoreB: 0,
        status: 'scheduled',
        nextMatchId: savedFinal._id,
        nextMatchSlot: 'teamB'
      };

      tournament.matches.push(semi1, semi2);
      await tournament.save();

      res.status(200).json({ success: true, message: 'Đã khởi tạo xong Bán kết & Chung kết', tournament });
    } catch (error) {
      console.error('Setup knockout error:', error);
      res.status(500).json({ message: 'Lỗi server khi thiết lập Knockout' });
    }
  },

  // PUT /api/tournament/matches/:matchId (Admin or Scorer)
  updateMatchScore: async (req, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'scorer') {
        return res.status(403).json({ message: 'Chỉ admin hoặc trọng tài mới có quyền cập nhật tỉ số' });
      }

      const { matchId } = req.params;
      const { scoreA, scoreB, status, teamA, teamB } = req.body;

      let tournament = await resolveTargetTournament(req);
      // If matchId belongs to another tournament (when viewing a specific season), find it directly
      if (!tournament || !tournament.matches.id(matchId)) {
        tournament = await Tournament.findOne({ 'matches._id': matchId });
      }
      if (!tournament) {
        return res.status(404).json({ message: 'Không tìm thấy giải đấu' });
      }

      const match = tournament.matches.id(matchId);
      if (!match) {
        return res.status(404).json({ message: 'Không tìm thấy trận đấu' });
      }

      if (scoreA !== undefined) match.scoreA = Number(scoreA);
      if (scoreB !== undefined) match.scoreB = Number(scoreB);
      if (status) match.status = status;

      if (teamA) {
        match.teamA = teamA;
        const t = tournament.teams.id(teamA);
        if (t) match.teamAName = t.name;
      }

      if (teamB) {
        match.teamB = teamB;
        const t = tournament.teams.id(teamB);
        if (t) match.teamBName = t.name;
      }

      if (match.status === 'completed') {
        let winningTeamId = null;
        let winningTeamName = '';

        if (match.scoreA > match.scoreB) {
          winningTeamId = match.teamA;
          winningTeamName = match.teamAName;
        } else if (match.scoreB > match.scoreA) {
          winningTeamId = match.teamB;
          winningTeamName = match.teamBName;
        }

        match.winnerTeamId = winningTeamId;
        match.winner = winningTeamName;

        if (match.stage === 'semi_final' && match.nextMatchId && winningTeamId) {
          const finalMatch = tournament.matches.id(match.nextMatchId);
          if (finalMatch) {
            if (match.nextMatchSlot === 'teamA') {
              finalMatch.teamA = winningTeamId;
              finalMatch.teamAName = winningTeamName;
            } else if (match.nextMatchSlot === 'teamB') {
              finalMatch.teamB = winningTeamId;
              finalMatch.teamBName = winningTeamName;
            }
          }
        }
      }

      await tournament.save();

      res.status(200).json({ success: true, message: 'Cập nhật trận đấu thành công', tournament });
    } catch (error) {
      console.error('Update match score error:', error);
      res.status(500).json({ message: 'Lỗi server khi cập nhật tỉ số' });
    }
  },

  // POST /api/tournament/reset-all (Admin)
  resetAll: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền reset giải đấu' });
      }

      let tournament = await resolveTargetTournament(req);
      if (!tournament) {
        return res.status(404).json({ message: 'Không tìm thấy giải đấu' });
      }

      tournament.teams = [];
      tournament.matches = [];
      await tournament.save();

      res.status(200).json({ success: true, message: 'Đã reset toàn bộ danh sách cặp đấu và tỉ số của mùa giải này', tournament });
    } catch (error) {
      console.error('Reset tournament error:', error);
      res.status(500).json({ message: 'Lỗi server khi reset giải đấu' });
    }
  },

  // POST /api/tournament/reset-scores (Admin)
  resetScores: async (req, res) => {
    try {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Chỉ admin mới có quyền reset tỉ số' });
      }

      let tournament = await resolveTargetTournament(req);
      if (!tournament) {
        return res.status(404).json({ message: 'Không tìm thấy giải đấu' });
      }

      tournament.matches.forEach(m => {
        m.scoreA = 0;
        m.scoreB = 0;
        m.status = 'scheduled';
        m.winner = '';
        m.winnerTeamId = null;
      });

      await tournament.save();

      res.status(200).json({ success: true, message: 'Đã reset toàn bộ tỉ số trận đấu', tournament });
    } catch (error) {
      console.error('Reset scores error:', error);
      res.status(500).json({ message: 'Lỗi server khi reset tỉ số' });
    }
  }
};

module.exports = tournamentController;
