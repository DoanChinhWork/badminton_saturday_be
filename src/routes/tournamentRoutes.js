const express = require('express');
const router = express.Router();
const tournamentController = require('../controllers/tournamentController');
const authMiddleware = require('../middleware/authMiddleware');

// Public route
router.get('/', tournamentController.getTournament);

// Admin season management routes
router.post('/seasons', authMiddleware, tournamentController.createSeason);
router.put('/seasons/:id', authMiddleware, tournamentController.updateSeasonInfo);
router.delete('/seasons/:id', authMiddleware, tournamentController.deleteSeason);

// Admin / Scorer tournament action routes
router.post('/pair-teams', authMiddleware, tournamentController.pairTeamsRandomly);
router.put('/teams', authMiddleware, tournamentController.updateTeams);
router.post('/generate-schedule', authMiddleware, tournamentController.generateGroupSchedule);
router.post('/setup-knockout', authMiddleware, tournamentController.setupKnockout);
router.put('/matches/:matchId', authMiddleware, tournamentController.updateMatchScore);
router.post('/reset-all', authMiddleware, tournamentController.resetAll);
router.post('/reset-scores', authMiddleware, tournamentController.resetScores);

module.exports = router;
