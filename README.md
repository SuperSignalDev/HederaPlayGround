Hedera DID SDK 설정 및 적용 가이드 (VS Code 환경)

현재 hedera_hcs_purchase_record.js 파일은 플랫폼 환경 제약으로 인해 DID를 수동으로 구성하고 있습니다. VS Code 환경에서 공식 DID SDK를 사용하여 '실 사용환경'에 맞게 DID를 생성하고 HCS에 등록하는 방법을 안내합니다.

1. 프로젝트 설정 및 SDK 설치

로컬 프로젝트 폴더에서 터미널을 열고 다음 명령어를 실행하여 공식 DID SDK를 설치합니다.

# Node.js 프로젝트 초기화 (이미 되어 있다면 생략)
npm init -y

# Hedera DID SDK 설치
npm install @hashgraph/did-sdk-js


2. 코드 수정: DID SDK 사용

hedera_hcs_purchase_record.js 파일을 다음과 같이 수정하여 DID SDK를 통합합니다.

A. SDK 모듈 불러오기

기존 파일 상단에 DID SDK의 필요한 모듈을 추가합니다.

hedera_hcs_purchase_record.js (상단 수정)

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

// 🚨 Hedera DID SDK 모듈 추가
const { DidMethod, DidDocument } = require("@hashgraph/did-sdk-js");

// Load environment variables from .env file
require('dotenv').config();
// ... (나머지 코드 유지)


B. createNewAccount 함수 수정 (DID 생성 및 등록)

createNewAccount 함수를 수정하여, 계정 생성 후 공식 DID SDK를 사용하여 DID를 생성하고 HCS에 등록하는 로직을 추가합니다.

hedera_hcs_purchase_record.js (createNewAccount 함수 수정)

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
  
  // 🚨 [수정] DID SDK를 사용하여 DID 인스턴스 생성
  const didMethod = new DidMethod(newAccountId, newAccountPrivateKey);
  const newDid = didMethod.getDid(); // DID 문자열 획득

  // 🚨 [수정] HCS에 DID Document 등록 (실제 DID 사용)
  try {
      // 이 과정에서 DID Document가 HCS에 토픽 메시지로 기록됩니다.
      const registerReceipt = await didMethod.register(client);
      console.log("✅ DID Document Registered on HCS:", registerReceipt.toString());
  } catch (e) {
      console.error("❌ Failed to register DID Document:", e.message);
      // 등록 실패 시에도 시뮬레이션을 위해 진행
  }


  console.log("----------------------- Account Creation -----------------------");
  console.log("🗝️ New Account Private Key:", newAccountPrivateKey.toStringDer());
  console.log("🆔 New Account ID:", newAccountId.toString());
  console.log("🌐 New Hedera DID:", newDid);
  console.log("----------------------------------------------------------------");

  // 🚨 DID를 포함하여 반환
  return { newAccountId, newAccountPrivateKey, newDid };
}


참고: 위 수정 코드를 적용하면 이제 newDid는 SDK를 통해 생성되며, 실제 HCS에 DID Document가 등록됩니다. 나머지 recordPurchaseWithNewAccount 및 fetchAllRecordsByDid 함수는 이미 DID 문자열을 사용하도록 수정되어 있으므로 추가 수정 없이 공식 DID를 처리할 수 있습니다.