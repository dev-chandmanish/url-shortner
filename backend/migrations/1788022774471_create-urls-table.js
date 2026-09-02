/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable("urls", {
    id: {
      type: "uuid",
      primaryKey: true,
    },
    // CASCADE: short URLs are owned by a user, so deleting the user should
    // remove their links instead of leaving orphaned rows.
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users",
      onDelete: "CASCADE",
    },
    short_code: {
      type: "text",
      notNull: true,
      unique: true,
    },
    original_url: {
      type: "text",
      notNull: true,
    },
    click_count: {
      type: "integer",
      notNull: true,
      default: 0,
      check: "click_count >= 0",
    },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("urls", "user_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("urls");
};
