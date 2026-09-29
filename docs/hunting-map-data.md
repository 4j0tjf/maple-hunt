# 공유 사냥터 데이터

위컴알에 포함된 `WzComparerR2.WzLib.dll`로 설치된 게임의 String·Map WZ와 Mob MS 파일을 읽어 JSON으로 추출하고 등록한다. 게임 파일은 읽기만 하며 이미지·음원은 복사하지 않는다. PowerShell 7과 net8.0-windows 위컴알 라이브러리로 확인했다.

```powershell
pwsh -NoProfile -File scripts/extract-wz-maps.ps1 -WcrDirectory 'C:\Users\user\Downloads\wcr2\net8.0-windows' -GameDirectory 'E:\nexon\Maple'
npm run maps:import -- data/extracted-hunting-maps.json
npm run maps:import -- data/extracted-hunting-maps.json --apply
```

추출 결과는 `data/extracted-hunting-maps.json`, 검토 보고서는 같은 경로의 `.report.json`이다. 기본 추출 명령은 운영 목록을 바꾸지 않는다. 보고서의 오류·제외 건을 확인하고 검증 후 등록한다. 게임 패치 후 같은 절차로 갱신한다. 라이브러리가 새 파일 형식을 지원하지 않으면 위컴알부터 갱신한다.

맵 `life`의 일반 몬스터 배치를 세며 NPC·숨겨진 몬스터·보스·별도 재생성 시간(`mobTime != 0`)을 제외한다. 마을·개인/파티 인스턴스·시간제 맵, 조건에 따라 배치가 바뀌는 맵은 제외한다. 맵의 링크와 몬스터 링크를 따라가며, 누락·순환·레벨 해석 오류가 있으면 해당 맵을 보고서에 남기고 제외한다. 서버의 실제 젠 제한·동적 이벤트까지 재현하는 값은 아니며, 요청한 **1젠 배치 수 × 48**의 대략적인 계산에 사용한다.

버전은 원본 WZ 헤더 버전과 추출 날짜다(공식 패치 번호와는 다름). 현재 추출본은 `KMS-WZ1206-2026-09-23`, 17,354개 맵 이미지에서 사냥터 2,054개를 얻었고 추출 오류는 0개였다.

직접 정리한 자료도 아래 형식으로 등록할 수 있다.

```json
{
  "version": "KMS-게임버전-추출날짜",
  "maps": [
    {
      "id": "123456789",
      "name": "예시 사냥터",
      "streetName": "예시 지역",
      "mobCount": 40,
      "monsterLevel": 265
    }
  ]
}
```

위 값은 형식 설명용이며 실제 사냥터 데이터가 아니다. `id`는 9자리 문자열, `name`은 40자 이내, `mobCount`는 1~500의 정수, `monsterLevel`은 1~300이다. 여러 몬스터가 섞인 맵은 `Σ(몬스터 레벨 × 해당 몬스터 수) ÷ 전체 몬스터 수`를 레벨에 넣는다. 추출기는 `monsters`에 ID·이름·레벨·배치 수도 저장하며 사이트가 개수·평균의 일치 여부를 검증한다.

```powershell
npm run maps:import -- D:\경로\hunting-maps.json
npm run maps:import -- D:\경로\hunting-maps.json --apply
```

첫 명령은 검증만 한다. 두 번째는 기존 데이터를 백업하고 목록 전체를 원자적으로 교체한다. 잘못된 항목·중복 맵 ID·빈 목록은 등록하지 않는다. 저장 위치는 `data/hunting-maps.json`이며 Git과 공개 정적 파일에서 제외한다. 새 데이터는 로그인 후 사냥 효율 카드 계산하기 칸의 **새로고침**으로 불러온다. 서버 재시작은 필요 없다.

사냥터를 검색·선택하면 1젠 몬스터 수와 레벨을 채운다. **6분 예상 마릿수 = 1젠당 몬스터 수 × 48**, 시간당은 그 값의 10배다. 기존 메소 배율·비약·일일 한도 계산을 이어서 적용한다. 예상 메소와 실제 획득량·손실률은 현재 사냥과 저장된 기록에서 비교한다.

OCR 이름이 목록의 사냥터와 유일하게 일치하고 저장된 수치가 없을 때 자동 적용한다. 이름이 같은 맵이 여럿이면 직접 선택한다. 사용자가 저장한 수치는 목록 갱신으로 덮지 않는다. 최신 데이터를 쓰려면 목록에서 다시 선택한다. 기록마다 계산 수치·맵 ID·데이터 버전을 저장하므로 목록을 교체해도 과거 기록의 기대값은 유지된다.

초대 코드·허용 목록 제한은 없다. 사냥터 데이터는 함께 사용하고 각자의 사냥 기록은 기존 캐릭터 비밀번호로 분리한다.

운영 중 빌드 검증은 `$env:HUNT_BUILD_DIR='.next-check'; npm run build`로 할 수 있다. 운영 배포 시에는 환경 변수를 제거하고 README의 서비스 중지·빌드·재시작 절차를 따른다.
