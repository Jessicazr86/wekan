const escapeForRegex = require('escape-string-regexp');

Meteor.publish('card', cardId => {
  check(cardId, String);
  return Cards.find({ _id: cardId });
});

Meteor.publish('myCards', function(sessionId) {
  const queryParams = {
    users: [Meteor.user().username],
    // limit: 25,
    skip: 0,
    // sort: { name: 'dueAt', order: 'des' },
  };

  return findCards(sessionId, buildQuery(queryParams));
});

// Meteor.publish('dueCards', function(sessionId, allUsers = false) {
//   check(sessionId, String);
//   check(allUsers, Boolean);
//
//   // eslint-disable-next-line no-console
//   // console.log('all users:', allUsers);
//
//   const queryParams = {
//     has: [{ field: 'dueAt', exists: true }],
//     limit: 25,
//     skip: 0,
//     sort: { name: 'dueAt', order: 'des' },
//   };
//
//   if (!allUsers) {
//     queryParams.users = [Meteor.user().username];
//   }
//
//   return buildQuery(sessionId, queryParams);
// });

Meteor.publish('globalSearch', function(sessionId, queryParams) {
  check(sessionId, String);
  check(queryParams, Object);

  // eslint-disable-next-line no-console
  // console.log('queryParams:', queryParams);

  return findCards(sessionId, buildQuery(queryParams));
});

class QueryErrors {
  constructor() {
    this.notFound = {
      boards: [],
      swimlanes: [],
      lists: [],
      labels: [],
      users: [],
      members: [],
      assignees: [],
      status: [],
      comments: [],
    };

    this.colorMap = Boards.colorMap();
  }

  hasErrors() {
    for (const value of Object.values(this.notFound)) {
      if (value.length) {
        return true;
      }
    }
    return false;
  }

  errorMessages() {
    const messages = [];

    this.notFound.boards.forEach(board => {
      messages.push({ tag: 'board-title-not-found', value: board });
    });
    this.notFound.swimlanes.forEach(swim => {
      messages.push({ tag: 'swimlane-title-not-found', value: swim });
    });
    this.notFound.lists.forEach(list => {
      messages.push({ tag: 'list-title-not-found', value: list });
    });
    this.notFound.comments.forEach(comments => {
      comments.forEach(text => {
        messages.push({ tag: 'comment-not-found', value: text });
      });
    });
    this.notFound.labels.forEach(label => {
      if (Boards.labelColors().includes(label)) {
        messages.push({
          tag: 'label-color-not-found',
          value: label,
          color: true,
        });
      } else {
        messages.push({
          tag: 'label-not-found',
          value: label,
          color: false,
        });
      }
    });
    this.notFound.users.forEach(user => {
      messages.push({ tag: 'user-username-not-found', value: user });
    });
    this.notFound.members.forEach(user => {
      messages.push({ tag: 'user-username-not-found', value: user });
    });
    this.notFound.assignees.forEach(user => {
      messages.push({ tag: 'user-username-not-found', value: user });
    });

    return messages;
  }
};

class Query {
  params = {};
  selector = {};
  projection = {};
  errors = new QueryErrors();

  constructor(selector, projection) {
    if (selector) {
      this.selector = selector;
    }

    if (projection) {
      this.projection = projection;
    }
  }
}

function buildSelector(queryParams) {
  const userId = Meteor.userId();

  errors = new QueryErrors();

  let selector = {};

  if (queryParams.selector) {
    selector = queryParams.selector;
  } else {
    const boardsSelector = {};

    let archived = false;
    let endAt = null;
    if (queryParams.status && queryParams.status.length) {
      queryParams.status.forEach(status => {
        if (status === 'archived') {
          archived = true;
        } else if (status === 'all') {
          archived = null;
        } else if (status === 'ended') {
          endAt = { $nin: [null, ''] };
        } else if (['private', 'public'].includes(status)) {
          boardsSelector.permission = status;
        }
      });
    }
    selector = {
      type: 'cardType-card',
      // boardId: { $in: Boards.userBoardIds(userId) },
      $and: [],
    };

    if (archived !== null) {
      if (archived) {
        selector.boardId = {
          $in: Boards.userBoardIds(userId, null, boardsSelector),
        };
        selector.$and.push({
          $or: [
            {
              boardId: {
                $in: Boards.userBoardIds(userId, archived, boardsSelector),
              },
            },
            { swimlaneId: { $in: Swimlanes.archivedSwimlaneIds() } },
            { listId: { $in: Lists.archivedListIds() } },
            { archived: true },
          ],
        });
      } else {
        selector.boardId = {
          $in: Boards.userBoardIds(userId, false, boardsSelector),
        };
        selector.swimlaneId = { $nin: Swimlanes.archivedSwimlaneIds() };
        selector.listId = { $nin: Lists.archivedListIds() };
        selector.archived = false;
      }
    } else {
      selector.boardId = {
        $in: Boards.userBoardIds(userId, null, boardsSelector),
      };
    }
    if (endAt !== null) {
      selector.endAt = endAt;
    }

    if (queryParams.boards && queryParams.boards.length) {
      const queryBoards = [];
      queryParams.boards.forEach(query => {
        const boards = Boards.userSearch(userId, {
          title: new RegExp(escapeForRegex(query), 'i'),
        });
        if (boards.count()) {
          boards.forEach(board => {
            queryBoards.push(board._id);
          });
        } else {
          errors.notFound.boards.push(query);
        }
      });

      selector.boardId.$in = queryBoards;
    }

    if (queryParams.swimlanes && queryParams.swimlanes.length) {
      const querySwimlanes = [];
      queryParams.swimlanes.forEach(query => {
        const swimlanes = Swimlanes.find({
          title: new RegExp(escapeForRegex(query), 'i'),
        });
        if (swimlanes.count()) {
          swimlanes.forEach(swim => {
            querySwimlanes.push(swim._id);
          });
        } else {
          errors.notFound.swimlanes.push(query);
        }
      });

      // eslint-disable-next-line no-prototype-builtins
      if (!selector.swimlaneId.hasOwnProperty('swimlaneId')) {
        selector.swimlaneId = { $in: [] };
      }
      selector.swimlaneId.$in = querySwimlanes;
    }

    if (queryParams.lists && queryParams.lists.length) {
      const queryLists = [];
      queryParams.lists.forEach(query => {
        const lists = Lists.find({
          title: new RegExp(escapeForRegex(query), 'i'),
        });
        if (lists.count()) {
          lists.forEach(list => {
            queryLists.push(list._id);
          });
        } else {
          errors.notFound.lists.push(query);
        }
      });

      // eslint-disable-next-line no-prototype-builtins
      if (!selector.hasOwnProperty('listId')) {
        selector.listId = { $in: [] };
      }
      selector.listId.$in = queryLists;
    }

    if (queryParams.comments && queryParams.comments.length) {
      const cardIds = CardComments.textSearch(userId, queryParams.comments).map(
        com => {
          return com.cardId;
        },
      );
      if (cardIds.length) {
        selector._id = { $in: cardIds };
      } else {
        errors.notFound.comments.push(queryParams.comments);
      }
    }

    ['dueAt', 'createdAt', 'modifiedAt'].forEach(field => {
      if (queryParams[field]) {
        selector[field] = {};
        selector[field][queryParams[field].operator] = new Date(
          queryParams[field].value,
        );
      }
    });

    const queryMembers = [];
    const queryAssignees = [];
    if (queryParams.users && queryParams.users.length) {
      queryParams.users.forEach(query => {
        const users = Users.find({
          username: query,
        });
        if (users.count()) {
          users.forEach(user => {
            queryMembers.push(user._id);
            queryAssignees.push(user._id);
          });
        } else {
          errors.notFound.users.push(query);
        }
      });
    }

    if (queryParams.members && queryParams.members.length) {
      queryParams.members.forEach(query => {
        const users = Users.find({
          username: query,
        });
        if (users.count()) {
          users.forEach(user => {
            queryMembers.push(user._id);
          });
        } else {
          errors.notFound.members.push(query);
        }
      });
    }

    if (queryParams.assignees && queryParams.assignees.length) {
      queryParams.assignees.forEach(query => {
        const users = Users.find({
          username: query,
        });
        if (users.count()) {
          users.forEach(user => {
            queryAssignees.push(user._id);
          });
        } else {
          errors.notFound.assignees.push(query);
        }
      });
    }

    if (queryMembers.length && queryAssignees.length) {
      selector.$and.push({
        $or: [
          { members: { $in: queryMembers } },
          { assignees: { $in: queryAssignees } },
        ],
      });
    } else if (queryMembers.length) {
      selector.members = { $in: queryMembers };
    } else if (queryAssignees.length) {
      selector.assignees = { $in: queryAssignees };
    }

    if (queryParams.labels && queryParams.labels.length) {
      queryParams.labels.forEach(label => {
        const queryLabels = [];

        let boards = Boards.userSearch(userId, {
          labels: { $elemMatch: { color: label.toLowerCase() } },
        });

        if (boards.count()) {
          boards.forEach(board => {
            // eslint-disable-next-line no-console
            // console.log('board:', board);
            // eslint-disable-next-line no-console
            // console.log('board.labels:', board.labels);
            board.labels
              .filter(boardLabel => {
                return boardLabel.color === label.toLowerCase();
              })
              .forEach(boardLabel => {
                queryLabels.push(boardLabel._id);
              });
          });
        } else {
          // eslint-disable-next-line no-console
          // console.log('label:', label);
          const reLabel = new RegExp(escapeForRegex(label), 'i');
          // eslint-disable-next-line no-console
          // console.log('reLabel:', reLabel);
          boards = Boards.userSearch(userId, {
            labels: { $elemMatch: { name: reLabel } },
          });

          if (boards.count()) {
            boards.forEach(board => {
              board.labels
                .filter(boardLabel => {
                  if (!boardLabel.name) {
                    return false;
                  }
                  return boardLabel.name.match(reLabel);
                })
                .forEach(boardLabel => {
                  queryLabels.push(boardLabel._id);
                });
            });
          } else {
            errors.notFound.labels.push(label);
          }
        }

        selector.labelIds = { $in: queryLabels };
      });
    }

    if (queryParams.has && queryParams.has.length) {
      queryParams.has.forEach(has => {
        switch (has.field) {
          case 'attachment':
            selector.$and.push({
              _id: {
                $in: Attachments.find({}, { fields: { cardId: 1 } }).map(
                  a => a.cardId,
                ),
              },
            });
            break;
          case 'checklist':
            selector.$and.push({
              _id: {
                $in: Checklists.find({}, { fields: { cardId: 1 } }).map(
                  a => a.cardId,
                ),
              },
            });
            break;
          case 'description':
          case 'startAt':
          case 'dueAt':
          case 'endAt':
            if (has.exists) {
              selector[has.field] = { $exists: true, $nin: [null, ''] };
            } else {
              selector[has.field] = { $in: [null, ''] };
            }
            break;
          case 'assignees':
          case 'members':
            if (has.exists) {
              selector[has.field] = { $exists: true, $nin: [null, []] };
            } else {
              selector[has.field] = { $in: [null, []] };
            }
            break;
        }
      });
    }

    if (queryParams.text) {
      const regex = new RegExp(escapeForRegex(queryParams.text), 'i');

      const items = ChecklistItems.find(
        { title: regex },
        { fields: { cardId: 1 } },
      );
      const checklists = Checklists.find(
        {
          $or: [
            { title: regex },
            { _id: { $in: items.map(item => item.checklistId) } },
          ],
        },
        { fields: { cardId: 1 } },
      );

      const attachments = Attachments.find({ 'original.name': regex });

      // const comments = CardComments.find(
      //   { text: regex },
      //   { fields: { cardId: 1 } },
      // );

      selector.$and.push({
        $or: [
          { title: regex },
          { description: regex },
          { customFields: { $elemMatch: { value: regex } } },
          {
            _id: {
              $in: CardComments.textSearch(userId, [queryParams.text]).map(
                com => com.cardId,
              ),
            },
          },
          { _id: { $in: checklists.map(list => list.cardId) } },
          { _id: { $in: attachments.map(attach => attach.cardId) } },
          // { _id: { $in: comments.map(com => com.cardId) } },
        ],
      });
    }

    if (selector.$and.length === 0) {
      delete selector.$and;
    }
  }

  // eslint-disable-next-line no-console
  // console.log('selector:', selector);
  // eslint-disable-next-line no-console
  // console.log('selector.$and:', selector.$and);

  const query = new Query();
  query.selector = selector;
  query.params = queryParams;
  query.errors = errors;

  return query;
}

function buildProjection(query) {

  let skip = 0;
  if (query.params.skip) {
    skip = query.params.skip;
  }
  let limit = 25;
  if (query.params.limit) {
    limit = query.params.limit;
  }

  const projection = {
    fields: {
      _id: 1,
      archived: 1,
      boardId: 1,
      swimlaneId: 1,
      listId: 1,
      title: 1,
      type: 1,
      sort: 1,
      members: 1,
      assignees: 1,
      colors: 1,
      dueAt: 1,
      createdAt: 1,
      modifiedAt: 1,
      labelIds: 1,
      customFields: 1,
    },
    sort: {
      boardId: 1,
      swimlaneId: 1,
      listId: 1,
      sort: 1,
    },
    skip,
    limit,
  };

  if (query.params.sort) {
    const order = query.params.sort.order === 'asc' ? 1 : -1;
    switch (query.params.sort.name) {
      case 'dueAt':
        projection.sort = {
          dueAt: order,
          boardId: 1,
          swimlaneId: 1,
          listId: 1,
          sort: 1,
        };
        break;
      case 'modifiedAt':
        projection.sort = {
          modifiedAt: order,
          boardId: 1,
          swimlaneId: 1,
          listId: 1,
          sort: 1,
        };
        break;
      case 'createdAt':
        projection.sort = {
          createdAt: order,
          boardId: 1,
          swimlaneId: 1,
          listId: 1,
          sort: 1,
        };
        break;
      case 'system':
        projection.sort = {
          boardId: order,
          swimlaneId: order,
          listId: order,
          modifiedAt: order,
          sort: order,
        };
        break;
    }
  }

  // eslint-disable-next-line no-console
  // console.log('projection:', projection);

  query.projection = projection;

  return query;
}

function buildQuery(queryParams) {
  const query = buildSelector(queryParams);

  return buildProjection(query);
}

Meteor.publish('brokenCards', function(sessionId) {

  const queryParams = {
    users: [Meteor.user().username],
    // limit: 25,
    skip: 0,
    // sort: { name: 'dueAt', order: 'des' },
  };
  const query = buildQuery(queryParams);
  query.selector.$or = [
    { boardId: { $in: [null, ''] } },
    { swimlaneId: { $in: [null, ''] } },
    { listId: { $in: [null, ''] } },
  ];

  return findCards(sessionId, query);
});

Meteor.publish('nextPage', function(sessionId) {
  check(sessionId, String);

  const session = SessionData.findOne({ sessionId });
  const projection = session.getProjection();
  projection.skip = session.lastHit;

  return findCards(sessionId, new Query(session.getSelector(), projection));
});

Meteor.publish('previousPage', function(sessionId) {
  check(sessionId, String);

  const session = SessionData.findOne({ sessionId });
  const projection = session.getProjection();
  projection.skip = session.lastHit - session.resultsCount - projection.limit;

  return findCards(sessionId, new Query(session.getSelector(), projection));
});

function findCards(sessionId, query) {
  const userId = Meteor.userId();

  // eslint-disable-next-line no-console
  console.log('selector:', query.selector);
  console.log('selector.$and:', query.selector.$and);
  // eslint-disable-next-line no-console
  // console.log('projection:', projection);
  let cards;
  if (!errors || !errors.hasErrors()) {
    cards = Cards.find(query.selector, query.projection);
  }
  // eslint-disable-next-line no-console
  // console.log('count:', cards.count());

  const update = {
    $set: {
      totalHits: 0,
      lastHit: 0,
      resultsCount: 0,
      cards: [],
      selector: SessionData.pickle(query.selector),
      projection: SessionData.pickle(query.projection),
      errors: query.errors.errorMessages(),
    },
  };
  // if (errors) {
  //   update.$set.errors = errors.errorMessages();
  // }

  if (cards) {
    update.$set.totalHits = cards.count();
    update.$set.lastHit =
      query.projection.skip + query.projection.limit < cards.count()
        ? query.projection.skip + query.projection.limit
        : cards.count();
    update.$set.cards = cards.map(card => {
      return card._id;
    });
    update.$set.resultsCount = update.$set.cards.length;
  }

  SessionData.upsert({ userId, sessionId }, update);

  // remove old session data
  SessionData.remove({
    userId,
    modifiedAt: {
      $lt: new Date(
        moment()
          .subtract(1, 'day')
          .format(),
      ),
    },
  });

  if (cards) {
    const boards = [];
    const swimlanes = [];
    const lists = [];
    const customFieldIds = [];
    const users = [this.userId];

    cards.forEach(card => {
      if (card.boardId) boards.push(card.boardId);
      if (card.swimlaneId) swimlanes.push(card.swimlaneId);
      if (card.listId) lists.push(card.listId);
      if (card.members) {
        card.members.forEach(userId => {
          users.push(userId);
        });
      }
      if (card.assignees) {
        card.assignees.forEach(userId => {
          users.push(userId);
        });
      }
      if (card.customFields) {
        card.customFields.forEach(field => {
          customFieldIds.push(field._id);
        });
      }
    });

    const fields = {
      _id: 1,
      title: 1,
      archived: 1,
      sort: 1,
      type: 1,
    };

    return [
      cards,
      Boards.find(
        { _id: { $in: boards } },
        { fields: { ...fields, labels: 1, color: 1 } },
      ),
      Swimlanes.find(
        { _id: { $in: swimlanes } },
        { fields: { ...fields, color: 1 } },
      ),
      Lists.find({ _id: { $in: lists } }, { fields }),
      CustomFields.find({ _id: { $in: customFieldIds } }),
      Users.find({ _id: { $in: users } }, { fields: Users.safeFields }),
      Checklists.find({ cardId: { $in: cards.map(c => c._id) } }),
      Attachments.find({ cardId: { $in: cards.map(c => c._id) } }),
      CardComments.find({ cardId: { $in: cards.map(c => c._id) } }),
      SessionData.find({ userId, sessionId }),
    ];
  }

  return [SessionData.find({ userId, sessionId })];
}
