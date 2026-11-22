routerAdd('GET', '/api/daytrace/friends', e => require(__hooks + '/friends.js').list(e), $apis.requireAuth('users'));
routerAdd('POST', '/api/daytrace/invites', e => require(__hooks + '/friends.js').invite(e), $apis.requireAuth('users'));
routerAdd('POST', '/api/daytrace/invites/accept', e => require(__hooks + '/friends.js').accept(e), $apis.requireAuth('users'));
routerAdd('POST', '/api/daytrace/heat/{id}', e => require(__hooks + '/friends.js').sendHeat(e), $apis.requireAuth('users'));
routerAdd('GET', '/api/daytrace/heat/{id}', e => require(__hooks + '/friends.js').receivedHeat(e), $apis.requireAuth('users'));
