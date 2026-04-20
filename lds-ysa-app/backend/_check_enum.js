require('dotenv').config();
const{query}=require('./src/config/database');
query("SELECT unnest(enum_range(NULL::leadership_role)) as r").then(r=>{console.log(r.rows.map(x=>x.r));process.exit()}).catch(e=>{console.log(e.message);process.exit()});