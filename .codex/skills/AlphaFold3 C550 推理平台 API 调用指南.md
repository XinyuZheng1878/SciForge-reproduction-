# AlphaFold3 C550 推理平台 API 调用指南

═══ 环境信息



|项目|值|
|---|---|
|API 地址|http://10\.12\.111\.135:10010/v1/scimodel/tasks|
|认证地址|http://10\.12\.111\.135:10008/api/v1/auth/login|
|用户|ai4s\-discovery|
|必需 Header|x\-original\-model: alphafold3（所有请求）|
|超时|7200s|



═══ 使用流程



1. 获取 Token

```Bash
curl -s -X POST http://10.12.111.135:10008/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ai4s-discovery","password":"<password>"}'
```



返回 \{"token": "eyJ\.\.\."\}，有效期约 1 小时。



2. 上传数据到 Pod

数据放到共享 PVC /data/ 下，所有 Pod 可见：



```Bash
K8S="kubectl --kubeconfig=~/code/ai_lab/kubeconfig_dir/config-vc-c550-ai4s-sys -n studio-ams"
$K8S cp ./my.json deploy/alphafold3-1:/data/input/my.json
```



input\_dir 下可放多个 JSON，批量处理。



3. 提交任务

```Bash
curl -s -X POST http://10.12.111.135:10010/v1/scimodel/tasks \
  -H "Authorization: Bearer <token>" \
  -H "x-original-model: alphafold3" \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "fold",
    "inputs": {
      "input_dir": "/data/my_input_dir",
      "model_dir": "/opt/weights"
    }
  }'
```



返回 \{"task\_id": "xxxxxxxx\-xxxx"\}。



4. 轮询状态

```Bash
curl -s "http://10.12.111.135:10010/v1/scimodel/tasks/<task_id>" \
  -H "Authorization: Bearer <token>" \
  -H "x-original-model: alphafold3"
```



状态：queued → running → completed / failed。



5. 收集结果

结果在 Pod 临时目录，完成后立即搬移到 /data/：



```Bash
kubectl exec <pod> -- cp -r \
  /tmp/model_server/alphafold3_<task_id>/outputs/* \
  /data/results/my_batch/
```



每个输入 JSON 对应一个子目录，含 model\.cif、confidences\.json、ranking\_scores\.csv 等。



═══ 注意事项



- GET/POST 都必须带 x\-original\-model: alphafold3，漏了会 404

- /tmp/ 是临时存储，任务完成后必须搬移，超时或 Pod 重启会丢失

- Token 约 1 小时过期，长任务轮询需定时刷新

- 认证接口不支持并发，多任务提交间隔 ≥5 秒

═══ Shell 脚本模板



```Bash
#!/bin/bash
API_AUTH="http://10.12.111.135:10008/api/v1/auth/login"
API_TASKS="http://10.12.111.135:10010/v1/scimodel/tasks"

get_token() {
    curl -s -X POST "$API_AUTH" \
        -H "Content-Type: application/json" \
        -d '{"username":"ai4s-discovery","password":"<password>"}' \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
}

TOKEN=$(get_token)
TASK_ID=$(curl -s -X POST "$API_TASKS" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-original-model: alphafold3" \
    -H "Content-Type: application/json" \
    -d '{"task_type":"fold","inputs":{"input_dir":"/data/my_input","model_dir":"/opt/weights"}}' \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")

echo "Task: $TASK_ID"

for i in $(seq 1 90); do
    TOKEN=$(get_token)
    STATUS=$(curl -s "${API_TASKS}/${TASK_ID}" \
        -H "Authorization: Bearer $TOKEN" \
        -H "x-original-model: alphafold3" \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))")
    echo "[$i] $STATUS"
    [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] && break
    sleep 60
done
```



