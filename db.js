import 'dotenv/config';
import mysql from 'mysql2/promise';

//Jacob
// const pool = mysql.createPool({
//     host: "k2pdcy98kpcsweia.cbetxkdyhwsb.us-east-1.rds.amazonaws.com",
//     user: process.env.DB_USERNAME,
//     password: process.env.DB_PASSWORD,
//     database: "nm2pf20notjcum1m",
//     connectionLimit: 10,
//     waitForConnections: true
// });

//Daniel
const pool = mysql.createPool({
    host: "jw0ch9vofhcajqg7.cbetxkdyhwsb.us-east-1.rds.amazonaws.com",
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: "u2d8f0jswasdnehx",
    connectionLimit: 8,
    waitForConnections: true
});

// RDS closes connections that sit idle past its wait_timeout (default 8h). A
// pooled connection can go stale between queries without the pool noticing
// until it's actually used, so retry once against a fresh connection instead
// of letting a whole cron run fail because it happened to draw the stale one.
const TRANSIENT_ERROR_CODES = new Set([
    'PROTOCOL_CONNECTION_LOST',
    'ECONNRESET',
    'ER_CLIENT_INTERACTION_TIMEOUT',
    'ETIMEDOUT'
]);

const rawQuery = pool.query.bind(pool);

pool.query = async (...args) => {
    try {
        return await rawQuery(...args);
    } catch (err) {
        if (!TRANSIENT_ERROR_CODES.has(err.code)) {
            throw err;
        }

        console.warn(`Retrying query after transient DB error (${err.code})`);
        return await rawQuery(...args);
    }
};

export default pool;