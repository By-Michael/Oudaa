const catchAsync = require('../../utils/catchAsync');
const { globalSearch } = require('../../services/platformAdmin/platformSearchService');

const search = catchAsync(async (req, res) => {
  const data = await globalSearch(req.platformAdmin.role, req.query.q);
  res.json({ success: true, data });
});

module.exports = { search };
