# Spark SQL 血缘关系解析报告

## 最后一条 SQL 语句
```sql
INSERT OVERWRITE TABLE dwd.dim_account_df
SELECT sbs.sakan AS pk_account_id,
       ses.txt50 AS account_description,
       sbs.saknr AS g_l_account_number,
       sbs.ktopl AS account_table,
       1 AS is_valid,
       '2025-05-20 03:30:00' as etl_date,
       '2025-05-19' as dt
FROM ods.sap_ep1_ska1 sbs
LEFT JOIN ods.sap_ep1_skat ses
  ON sbs.saknr = ses.saknr
 AND sbs.ktopl = ses.ktopl
WHERE ses.ktopl='CN' 
  AND sbs.mandt='800' 
  AND ses.spras='1';
```

## 血缘关系解析

### 目标表
`dwd.dim_account_df` (维度表 - 账户维度)

### 源表
1. `ods.sap_ep1_ska1` (SAP SKA1 表 - 会计主数据)
2. `ods.sap_ep1_skat` (SAP SKAT 表 - 会计文本表)

### 字段血缘
| 目标字段           | 源字段         | 源表                  | 转换逻辑                 |
|--------------------|----------------|-----------------------|--------------------------|
| pk_account_id      | sakan          | sap_ep1_ska1 (sbs)    | 直接映射                 |
| account_description| txt50          | sap_ep1_skat (ses)    | 直接映射                 |
| g_l_account_number | saknr          | sap_ep1_ska1 (sbs)    | 直接映射                 |
| account_table      | ktopl          | sap_ep1_ska1 (sbs)    | 直接映射                 |
| is_valid           | 常量           | 无                    | 固定值 1                 |
| etl_date           | 常量           | 无                    | 固定时间戳               |
| dt                 | 常量           | 无                    | 分区字段(2025-05-19)    |

### 关键关联条件
- LEFT JOIN 条件:
  - `sbs.saknr = ses.saknr` (总账科目编号)
  - `sbs.ktopl = ses.ktopl` (会计科目表)

### 数据过滤条件
- `ses.ktopl='CN'` (中国会计准则)
- `sbs.mandt='800'` (客户端800)
- `ses.spras='1'` (语言代码1)

### 数据流图示
```
ods.sap_ep1_ska1 ----<\n                     \\ 
                      \\--> dwd.dim_account_df
ods.sap_ep1_skat ----<
```