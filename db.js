import 'dotenv/config';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
    host: "k2pdcy98kpcsweia.cbetxkdyhwsb.us-east-1.rds.amazonaws.com",
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: "nm2pf20notjcum1m",
    connectionLimit: 10,
    waitForConnections: true
});

// const pool = mysql.createPool({
//     host: "jw0ch9vofhcajqg7.cbetxkdyhwsb.us-east-1.rds.amazonaws.com",
//     user: process.env.DB_USERNAME,
//     password: process.env.DB_PASSWORD,
//     database: "u2d8f0jswasdnehx",
//     connectionLimit: 8,
//     waitForConnections: true
// });

export default pool;