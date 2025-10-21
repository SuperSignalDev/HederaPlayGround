const {
    AccountId,
    PrivateKey,
    Client,
    AccountCreateTransaction,
    Hbar,
    TopicCreateTransaction,
    TopicMessageSubmitTransaction,
    TopicInfoQuery,
    TopicId // Topic ID 처리를 위해 추가
  } = require("@hashgraph/sdk"); // v2.64.5

// Load environment variables from .env file
require('dotenv').config();

// ---------------------------
// 1️⃣ Client 생성 및 Operator 설정
// ---------------------------
function createClient(operatorIdStr, operatorKeyStr) {
  // 환경 변수 검증
  if (!operatorIdStr || !operatorKeyStr) {
    throw new Error("Operator ID 또는 Key가 .env 파일에 누락되었습니다.");
  }

  const client = Client.forTestnet();
  // Operator 계정 설정
  client.setOperator(operatorIdStr, operatorKeyStr);
  return client;
}

// ---------------------------
// 2️⃣ 새 계정 생성 (Operator가 gas 대납)
// ---------------------------
async function createNewAccount(client) {
  // 새 계정 키 생성
  const newAccountPrivateKey = PrivateKey.generateECDSA();
  const newAccountPublicKey = newAccountPrivateKey.publicKey;

  // 계정 생성 트랜잭션 실행
  const txResponse = await new AccountCreateTransaction()
    .setKey(newAccountPublicKey)
    .setInitialBalance(Hbar.fromTinybars(0))
    .execute(client); 

  // 영수증 및 계정 ID 획득
  const receipt = await txResponse.getReceipt(client);
  const newAccountId = receipt.accountId;

  console.log("----------------------- Account Creation -----------------------");
  console.log("🗝️ New Account Private Key:", newAccountPrivateKey.toStringDer());
  console.log("🔑 New Account Public Key:", newAccountPublicKey.toStringDer());
  console.log("🆔 New Account ID:", newAccountId.toString());
  console.log("----------------------------------------------------------------");

  return { newAccountId, newAccountPrivateKey };
}

// ---------------------------
// 3️⃣ HCS Topic 생성
// ---------------------------
async function createTopic(client) {
  const tx = await new TopicCreateTransaction().execute(client);
  const receipt = await tx.getReceipt(client);
  const topicId = receipt.topicId;
  
  console.log("----------------------- Topic Creation -------------------------");
  console.log("📝 New Topic ID:", topicId.toString());
  console.log("----------------------------------------------------------------");
  return topicId;
}

// ---------------------------
// 4️⃣ Topic 정보 쿼리를 통해 토픽 존재 여부 확인 
// ---------------------------
async function verifyTopicCreated(client, topicId) {
    console.log(`🔎 Verifying topic ${topicId.toString()} information...`);
    try {
        await new TopicInfoQuery()
            .setTopicId(topicId)
            .execute(client);

        console.log(`✅ Topic ${topicId.toString()} verified.`);
        return true;
    } catch (error) {
        // NOT_FOUND나 다른 오류 발생 시 토픽이 유효하지 않다고 판단
        console.error(`❌ Failed to retrieve info for topic ${topicId.toString()}. Error: ${error.message}`);
        return false;
    }
}

// ---------------------------
// 5️⃣ 구매 내역을 새 계정으로 서명하고, Operator가 gas 대납
// ---------------------------
async function recordPurchaseWithNewAccount(client, topicId, purchaseData, newAccountPrivateKey) {
  const message = JSON.stringify(purchaseData);
  
  // 새 계정이 트랜잭션에 서명하고, Operator가 제출 및 gas 대납
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .freezeWith(client)                
    .sign(newAccountPrivateKey);       

  const submitTx = await tx.execute(client); 
  const receipt = await submitTx.getReceipt(client);

  console.log(`   [Submit] User ${purchaseData.user_id.split('.')[2]} - ${purchaseData.sequence}: ${receipt.status.toString()}`);
}

// ---------------------------
// 6️⃣ 미러 노드에서 특정 계정의 구매 기록을 '모두' 조회 및 필터링 (페이지네이션 적용 및 이름 변경)
// ---------------------------
async function fetchAllRecordsByAccountId(topicId, accountId) {
    let foundRecords = [];
    let processedMessagesCount = 0; // 토픽에서 처리된 전체 메시지 수를 기록
    const targetAccountIdStr = accountId.toString();
    // 초기 URL: 최대 100개씩, 오름차순으로 가져옴. 미러 노드 주소 확인 및 사용.
    let nextUrl = `https://testnet.mirrornode.hedera.com/api/v1/topics/${topicId.toString()}/messages?limit=100&order=asc`;

    console.log(`\n🔍 Starting query to Mirror Node for all messages on topic ${topicId.toString()} (using pagination)...`);

    while (nextUrl) {
        try {
            const response = await fetch(nextUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status} from URL: ${nextUrl}`);
            }
            
            const data = await response.json();
            
            // 🚨 로그 추가: 현재 페이지에서 가져온 메시지 수 및 페이지네이션 정보 출력
            console.log(`   [Pagination] Fetched ${data.messages.length} messages from: ${nextUrl.substring(nextUrl.indexOf('/api'))}`);
            
            for (const message of data.messages) {
                // 메시지 내용은 Base64로 인코딩되어 있으므로 디코딩 필요
                const decodedContent = Buffer.from(message.message, 'base64').toString('utf8');
                
                processedMessagesCount++; // 전체 메시지 수 증가
                
                // JSON 파싱 중 오류가 발생할 수 있으므로 try-catch 추가
                try {
                    const record = JSON.parse(decodedContent);
                    
                    // 메시지 내부의 'user_id' 필드를 우리가 생성한 계정 ID와 비교
                    if (record.user_id === targetAccountIdStr) {
                        foundRecords.push({
                            consensusTimestamp: message.consensus_timestamp,
                            sequenceNumber: message.sequence_number,
                            data: record
                        });
                    }
                } catch (jsonError) {
                    console.warn(`   [Warning] Failed to parse message content JSON at timestamp ${message.consensus_timestamp}`);
                }
            }

            // 다음 페이지 URL 설정
            // data.links.next가 있으면 다음 URL을 구성하고, 없으면 루프를 종료하기 위해 null로 설정
            nextUrl = data.links && data.links.next ? 
                      `https://testnet.mirrornode.hedera.com${data.links.next}` : 
                      null;

        } catch (e) {
            console.error("❌ Error fetching from Mirror Node:", e.message);
            return null;
        }
    }
    
    // 🚨 로그 추가: 최종 처리된 메시지 수 출력
    console.log(`\n🎉 Completed query. Total messages processed in topic: ${processedMessagesCount}.`);
    
    return foundRecords;
}

// ---------------------------
// 7️⃣ 시뮬레이션 함수 
// ---------------------------
async function simulatePurchaseRecords(client, topicId, numUsers, numSubmissionsPerUser) {
    const totalMessages = numUsers * numSubmissionsPerUser;
    
    console.log(`\n=================== Simulation Start (${numUsers} Users, ${numSubmissionsPerUser} Records each) ===================`);

    // 1. 유저 생성 및 키 저장
    const users = [];
    console.log("\n===================== 1. Creating Users =====================");
    for (let i = 0; i < numUsers; i++) {
        const user = await createNewAccount(client);
        users.push(user);
    }

    // 2. 기록 전송 (Submission)
    console.log("\n================ 2. Submitting Purchase Records ================");
    for (const user of users) {
        const userIdShort = user.newAccountId.toString().split('.')[2];
        console.log(`\n🛒 User 0.0.${userIdShort} submitting ${numSubmissionsPerUser} records...`);
        
        for (let i = 1; i <= numSubmissionsPerUser; i++) {
            const purchaseData = {
                user_id: user.newAccountId.toString(),
                date: new Date().toISOString().split('T')[0],
                item: `Product ${i}`,
                price: 100 + i * 10,
                order_id: `ORDER-${userIdShort}-${i}`,
                sequence: i
            };
            await recordPurchaseWithNewAccount(client, topicId, purchaseData, user.newAccountPrivateKey);
        }
    }
    
    // 3. 미러 노드 동기화 대기
    const syncWaitTime = 10000; // 10초 대기
    console.log(`\n⏳ Waiting ${syncWaitTime / 1000} seconds for all ${totalMessages} messages to appear on the Mirror Node...`);
    await new Promise(resolve => setTimeout(resolve, syncWaitTime)); 

    // 4. 기록 조회 및 출력 (Fetching)
    console.log("\n================= 3. Fetching and Verifying Records =================");
    for (const user of users) {
        const userIdShort = user.newAccountId.toString().split('.')[2];
        console.log(`\n--- Fetching Records for User: 0.0.${userIdShort} (ID: ${user.newAccountId.toString()}) ---`);
        
        // 🚨 모든 기록을 가져오는 함수 호출
        const records = await fetchAllRecordsByAccountId(topicId, user.newAccountId);
        
        const recordsFound = records ? records.length : 0; // 찾은 기록 수
        
        // 🚨 수정: 총 레코드 수 출력
        console.log(`💡 Total records found for this user in topic: ${recordsFound} (Expected: ${numSubmissionsPerUser})`);
        
        if (recordsFound > 0) {
            console.log("----------------------------------------------------------------------------------------------------");
            // 🚨 수정: 모든 기록 출력
            records.forEach(record => {
                console.log(`   [Rec #${record.data.sequence} | Time: ${record.consensusTimestamp}] Item: ${record.data.item}, Price: ${record.data.price}, Order ID: ${record.data.order_id}`);
            });
            console.log("----------------------------------------------------------------------------------------------------");
            
        } else {
            console.log(`❌ Warning: Expected ${numSubmissionsPerUser} records but found 0 for this user.`);
            console.log("   -> 미러 노드에 기록이 아직 반영되지 않았거나 필터링 조건과 일치하는 메시지가 없습니다.");
        }
    }
}


// ---------------------------
// 8️⃣ 메인 실행
// ---------------------------
async function main() {
  // Load account details from environment variables
  const OPERATOR_ID = process.env.OPERATOR_ID;
  const OPERATOR_KEY = process.env.OPERATOR_KEY;

  // IMPORTANT: Cast environment variables to the correct Hedera SDK types
  const operatorIdInstance = AccountId.fromString(OPERATOR_ID);
  const operatorKeyInstance = PrivateKey.fromStringECDSA(OPERATOR_KEY);


  const client = createClient(operatorIdInstance, operatorKeyInstance);
  let topicId;

  try {
    // 1. TOPIC ID 로드 및 생성/사용 결정
    const TOPIC_ID_ENV = process.env.TOPIC_ID;
    
    if (TOPIC_ID_ENV && TOPIC_ID_ENV.trim() !== "") {
        topicId = TopicId.fromString(TOPIC_ID_ENV.trim());
        console.log(`✅ Using existing Topic ID from .env: ${topicId.toString()}`);
        
        // 기존 토픽 검증
        const verified = await verifyTopicCreated(client, topicId);
        if (!verified) {
            console.warn(`⚠️ The existing Topic ID ${topicId.toString()} could not be verified. Creating a new one.`);
            topicId = await createTopic(client);
        }
    } else {
        console.log("📝 TOPIC_ID가 .env에 설정되지 않았거나 비어 있습니다. 새로운 토픽을 생성합니다...");
        topicId = await createTopic(client);
    }
    
    // 2. 토픽 ID가 네트워크에 전파될 때까지 대기
    console.log("⏳ Waiting 5 seconds for Topic ID to propagate across the network...");
    await new Promise(resolve => setTimeout(resolve, 5000)); 
    
    // 3. 토픽 존재 여부 재검증 (네트워크 전파 후 최종 확인)
    const topicVerified = await verifyTopicCreated(client, topicId);
    if (!topicVerified) {
        throw new Error("Topic verification failed even after waiting. Aborting process.");
    }

    // 4. 시뮬레이션 실행 (4명의 유저, 각 10개의 기록)
    await simulatePurchaseRecords(client, topicId, 4, 10);
    
    console.log("\n✅ Process finished. Closing client.");

  } catch (err) {
    console.error("\n❌ An error occurred in main execution:", err);
  } finally {
    // Ensure the client is closed once the process is complete
    if (client) {
      client.close();
    }
  }
}

main();
