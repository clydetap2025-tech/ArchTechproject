function first(app, collection, filter, params) {
  return app.findRecordsByFilter(collection, filter, '', 1, 0, params)[0];
}

function displayName(app, id) {
  const user = app.findRecordById('users', id);
  const name = (user.getString('name') || user.email().split('@')[0]).replace(/[^\s@]+@[^\s@]+/g, address => address.split('@')[0]);
  return name.trim().slice(0, 64);
}

function pair(a, b) {
  return a < b ? { a, b } : { a: b, b: a };
}

function friendship(app, a, b) {
  return first(app, 'friendships', 'user_a = {:a} && user_b = {:b}', pair(a, b));
}

function inviteDate(time) {
  return new Date(time).toISOString().replace('T', ' ');
}

exports.list = e => {
  const id = e.auth.id;
  const rows = e.app.findRecordsByFilter('friendships', 'user_a = {:id} || user_b = {:id}', 'created', 0, 0, { id });
  return e.json(200, rows.map(row => {
    const a = row.getString('user_a');
    const friend = a === id ? row.getString('user_b') : a;
    return { id: friend, name: displayName(e.app, friend), friendship: row.id };
  }));
};

exports.invite = e => {
  const owner = e.auth.id;
  const now = Date.now();
  const expires = inviteDate(now + 24 * 60 * 60 * 1000);
  const token = $security.randomString(48);
  const row = new Record(e.app.findCollectionByNameOrId('invites'));
  row.set('owner', owner);
  row.set('token', token);
  row.set('expires', expires);
  e.app.save(row);
  return e.json(201, { token, expires });
};

exports.accept = e => {
  const token = e.requestInfo().body.token;
  const receiver = e.auth.id;
  if (typeof token !== 'string' || !/^[a-zA-Z0-9]{48}$/.test(token)) throw new NotFoundError();
  let friend;
  e.app.runInTransaction(tx => {
    const invite = first(tx, 'invites', 'token = {:token} && expires > {:now}', { token, now: inviteDate(Date.now()) });
    if (!invite) throw new NotFoundError();
    const sender = invite.getString('owner');
    if (sender === receiver) throw new BadRequestError();
    let row = friendship(tx, sender, receiver);
    if (!row) {
      const users = pair(sender, receiver);
      row = new Record(tx.findCollectionByNameOrId('friendships'));
      row.set('user_a', users.a);
      row.set('user_b', users.b);
      tx.save(row);
    }
    tx.delete(invite);
    friend = { id: sender, name: displayName(tx, sender), friendship: row.id };
  });
  return e.json(200, friend);
};

const tracks = [
  'night-docks', 'evening-fall', 'hard-boiled', 'space-jazz', 'clear-air', 'laid-back-guitars',
  'easy-lemon', 'carefree', 'casa-bossa', 'gymnopedie', 'dream-culture', 'luminous-rain', 'cool-vibes',
];

exports.sendHeat = e => {
  const sender = e.auth.id;
  const id = e.request.pathValue('id');
  const { kind, value } = e.requestInfo().body;
  const valid = typeof value === 'string' && (
    (kind === 'color' && /^#[a-f0-9]{6}$/i.test(value)) || (kind === 'track' && tracks.includes(value)));
  if (!valid) throw new BadRequestError();

  e.app.runInTransaction(tx => {
    const day = first(tx, 'day_atmospheres', 'id = {:id} && (visibility = "atmosphere" || visibility = "full")', { id });
    if (!day || day.getString('owner') === sender || !friendship(tx, sender, day.getString('owner'))) throw new NotFoundError();
    const row = first(tx, 'reactions', 'from = {:sender} && to_day_atmosphere = {:id}', { sender, id }) ||
      new Record(tx.findCollectionByNameOrId('reactions'));
    row.set('from', sender);
    row.set('to_day_atmosphere', id);
    row.set('kind', kind);
    row.set('value', kind === 'color' ? value.toLowerCase() : value);
    tx.save(row);
  });
  return e.json(201, {});
};

exports.receivedHeat = e => {
  const owner = e.auth.id;
  const id = e.request.pathValue('id');
  const day = first(e.app, 'day_atmospheres', 'id = {:id} && owner = {:owner}', { id, owner });
  if (!day) return e.json(200, []);
  const rows = e.app.findRecordsByFilter('reactions', 'to_day_atmosphere = {:id}', '-created', 0, 0, { id });
  return e.json(200, rows.map(row => ({
    name: displayName(e.app, row.getString('from')),
    kind: row.getString('kind'), value: row.getString('value'),
  })));
};
