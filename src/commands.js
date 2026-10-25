function parseCommand(text, caseData = {}) {
  const parts = String(text || '').trim().match(/^!(\S+)(?:\s+(\S+))?/i);
  if (!parts) return null;
  const command = parts[1].toLowerCase();
  const arg = parts[2] || '';
  const locations = Array.isArray(caseData.locations) ? caseData.locations : [{ id: 1 }, { id: 2 }, { id: 3 }];
  const suspects = caseData.suspects ? Object.keys(caseData.suspects) : ['A', 'B', 'C', 'D'];
  const evidence = caseData.locations ? caseData.locations.map(location => location.evidence?.id).filter(Boolean) : ['E1', 'E2', 'E3'];
  const location = locations.find(item => String(item.id) === arg);
  const suspect = suspects.find(key => key.toUpperCase() === arg.toUpperCase());
  const evidenceId = evidence.find(id => id.toUpperCase() === arg.toUpperCase());
  if (command === 'search' && location) return { type: 'search', value: location.id };
  if (command === 'ask' && suspect) return { type: 'ask', value: suspect };
  if ((command === 'contradict' || command === 'c') && evidenceId) return { type: 'contradict', value: evidenceId };
  if (command === 'accuse' && suspect) return { type: 'accuse', value: suspect };
  if (['next', 'reveal', 'reset'].includes(command)) return { type: 'host', action: command };
  return null;
}
module.exports = { parseCommand };
