migrate(app => {
  const users = app.findCollectionByNameOrId('users');
  const days = app.findCollectionByNameOrId('diary_days');
  const authenticated = '@request.auth.collectionId = "' + users.id + '"';
  const owned = 'owner = @request.auth.id';
  const friend = '(owner.friendships_via_user_a.user_b ?= @request.auth.id || owner.friendships_via_user_b.user_a ?= @request.auth.id)';
  const visibility = ['private', 'atmosphere', 'full'];
  const relation = (name, collection, hidden = false) => ({
    name, type: 'relation', collectionId: collection.id, required: true, maxSelect: 1, cascadeDelete: true, hidden,
  });
  const text = (name, max, extras = {}) => ({ name, type: 'text', max, ...extras });
  const select = (name, values) => ({ name, type: 'select', maxSelect: 1, values });
  const created = { name: 'created', type: 'autodate', onCreate: true };
  const create = (name, fields, settings = {}) => {
    const collection = new Collection({ type: 'base', name, fields, ...settings });
    app.save(collection);
    return collection;
  };

  create('invites', [
    relation('owner', users),
    text('token', 48, { required: true, hidden: true }), { name: 'expires', type: 'date', required: true },
  ], { indexes: ['CREATE UNIQUE INDEX idx_invite_token ON invites (token)', 'CREATE INDEX idx_invite_owner ON invites (owner)'] });

  const participant = authenticated + ' && (user_a = @request.auth.id || user_b = @request.auth.id)';
  create('friendships', [relation('user_a', users), relation('user_b', users), created], {
    listRule: participant, viewRule: participant, deleteRule: participant,
    indexes: [
      'CREATE UNIQUE INDEX idx_friend_pair ON friendships (user_a, user_b)',
      'CREATE INDEX idx_friend_b ON friendships (user_b)',
    ],
  });

  days.fields.add(new SelectField(select('visibility', visibility)));
  days.fields.add(new JSONField({ name: 'atmosphere_input', maxSize: 4096 }));
  days.viewRule = authenticated + ' && (' + owned + ' || (visibility = "full" && ' + friend + '))';
  days.listRule = days.viewRule;
  app.save(days);
  app.db().newQuery("UPDATE diary_days SET visibility = 'private' WHERE visibility = '' OR visibility IS NULL").execute();

  const shared = authenticated + ' && (' + owned + ' || ((visibility = "atmosphere" || visibility = "full") && ' + friend + '))';
  const atmospheres = create('day_atmospheres', [
    relation('owner', users), relation('day', days, true), text('date', 10),
    { name: 'palette', type: 'json', maxSize: 256 },
    { name: 'bpm', type: 'number' }, { name: 'mood_v', type: 'number' }, { name: 'mood_e', type: 'number' },
    select('mood_label', ['bright', 'quiet', 'nostalgia', 'blue', 'tense', 'lively']),
    { name: 'weather_summary', type: 'json', maxSize: 256 }, select('visibility', visibility),
  ], {
    listRule: shared, viewRule: shared,
    indexes: ['CREATE UNIQUE INDEX idx_atmosphere_day ON day_atmospheres (day)', 'CREATE INDEX idx_atmosphere_owner_date ON day_atmospheres (owner, date)'],
  });
  const received = authenticated + ' && to_day_atmosphere.owner = @request.auth.id';
  create('reactions', [
    relation('from', users), relation('to_day_atmosphere', atmospheres), select('kind', ['color', 'track']),
    text('value', 40, { required: true }), created,
  ], {
    listRule: received, viewRule: received,
    indexes: ['CREATE UNIQUE INDEX idx_heat_sender_day ON reactions ("from", to_day_atmosphere)'],
  });

  // Update the sanitized projection in the same database write as the privacy setting.
  // The only copied strings are a validated date, five hex colors and fixed enum values.
  const field = path => "json_extract(NEW.atmosphere_input, '$." + path + "')";
  const color = (index, fallback) => {
    const input = field('palette[' + index + ']');
    return "CASE WHEN length(" + input + ") = 7 AND substr(" + input + ", 1, 1) = '#' AND lower(substr(" + input + ", 2)) NOT GLOB '*[^0-9a-f]*' THEN lower(" + input + ") ELSE '" + fallback + "' END";
  };
  const numeric = (path, min, max, fallback) => {
    const input = field(path);
    return "CASE WHEN typeof(" + input + ") IN ('integer', 'real') AND " + input + " BETWEEN " + min + " AND " + max + " THEN " + input + " ELSE " + fallback + " END";
  };
  const date = "json_extract(NEW.entry, '$.date')";
  const fields = {
    id: 'NEW.id', day: 'NEW.id', owner: 'NEW.owner',
    date: "CASE WHEN " + date + " GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(" + date + ") = " + date + " THEN " + date + " ELSE '' END",
    palette: 'json_array(' + ['#24332d', '#4a6154', '#809383', '#b2b8a5', '#ded8c6'].map((fallback, i) => color(i, fallback)).join(', ') + ')',
    bpm: 'round(' + numeric('bpm', 35, 300, 0) + ')',
    mood_v: numeric('mood_v', -1, 1, 0), mood_e: numeric('mood_e', 0, 1, 0),
    mood_label: "CASE WHEN " + field('mood_label') + " IN ('bright','quiet','nostalgia','blue','tense','lively') THEN " + field('mood_label') + " ELSE 'quiet' END",
    weather_summary: "json_object('condition', CASE WHEN " + field('weather.condition') + " IN ('clear','cloudy','fog','rain','drizzle','snow','storm') THEN " + field('weather.condition') + " ELSE null END, 'temperature', round(" + numeric('weather.temperature', -100, 70, 'null') + '))',
    visibility: "CASE WHEN NEW.visibility IN ('atmosphere', 'full') THEN NEW.visibility ELSE 'private' END",
  };
  for (const [event, suffix] of [['INSERT', 'insert'], ['UPDATE', 'update']]) {
    app.db().newQuery('CREATE TRIGGER sync_day_atmosphere_' + suffix + ' AFTER ' + event +
      ' ON diary_days BEGIN INSERT INTO day_atmospheres (' + Object.keys(fields).join(', ') +
      ') VALUES (' + Object.values(fields).join(', ') + ') ON CONFLICT(id) DO UPDATE SET ' +
      Object.keys(fields).filter(name => name !== 'id').map(name => name + '=excluded.' + name).join(', ') +
      '; END').execute();
  }
});
