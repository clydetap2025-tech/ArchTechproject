migrate(app => {
  const users = app.findCollectionByNameOrId('users');
  const owner = '@request.auth.collectionId = "' + users.id + '" && owner = @request.auth.id';
  const file = (name, maxSelect, maxSize) => ({ name, type: 'file', protected: true, maxSelect, maxSize });
  app.save(new Collection({
    type: 'base', name: 'diary_days',
    listRule: owner, viewRule: owner, deleteRule: owner,
    createRule: owner, updateRule: owner + ' && @request.body.owner:changed = false && @request.body.dayKey:changed = false',
    fields: [
      { name: 'owner', type: 'relation', collectionId: users.id, required: true, cascadeDelete: true, maxSelect: 1 },
      { name: 'dayKey', type: 'text', required: true, pattern: '^[a-zA-Z0-9_-]{1,80}$' },
      { name: 'entry', type: 'json', required: true, maxSize: 1048576 },
      file('pictures', 8, 16 * 1048576), file('originals', 8, 64 * 1048576),
      file('cover', 1, 8 * 1048576), file('audio', 1, 128 * 1048576),
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_diary_owner_day ON diary_days (owner, dayKey)'],
  }));
});
