import duckdb

data=duckdb.read_json('../user_files/ContainerLogistics.json')
#data.show()
#print(duckdb.sql('SELECT obj FROM data, UNNEST(objects) AS t(obj)'))
print(duckdb.sql('SELECT obj.id, obj.type, attr.value, attr.time FROM data, UNNEST(objects) AS t(obj), UNNEST(obj.attributes) AS t2(attr);'))
print(duckdb.sql('SELECT DISTINCT obj.type FROM data, UNNEST(objects) AS t(obj);'))
print(duckdb.sql('SELECT DISTINCT obj.type, attr.name FROM data, UNNEST(objects) AS t(obj), UNNEST(obj.attributes) AS t2(attr);'))
print(duckdb.sql('SELECT obj.type, SUM(attr.value::FLOAT) AS total_value FROM data, UNNEST(objects) AS t(obj), UNNEST(obj.attributes) AS t2(attr) WHERE attr.name = \'Amount of Goods\' GROUP BY obj.type ORDER BY total_value DESC;'))
print(duckdb.sql('SELECT obj.id, SUM(attr.value::FLOAT) AS total_weight, SUM(attr.value::FLOAT *1000 / (SELECT SUM(attr.value::FLOAT) FROM data, UNNEST(objects) AS t(obj), UNNEST(obj.attributes) AS t2(attr) WHERE attr.name = \'Weight\')) AS weight_ratio_in_permille FROM data, UNNEST(objects) AS t(obj), UNNEST(obj.attributes) AS t2(attr) WHERE attr.name = \'Weight\' GROUP BY obj.id ORDER BY total_weight DESC;'))