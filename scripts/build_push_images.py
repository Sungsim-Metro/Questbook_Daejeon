#!/usr/bin/env python3
# Questbook 컨테이너 이미지를 빌드하고 NCP Container Registry로 푸시한다.
from __future__ import annotations

import argparse
import os
from pathlib import Path
import shlex
import subprocess
import sys


# 변수 의미: 저장소 루트 경로다.
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
# 변수 의미: 이미지 이름과 Dockerfile 경로 매핑이다.
IMAGES: dict[str, str] = {
    "qbook-web": "services/web-gateway/Dockerfile",
    "qbook-app": "services/app-api/Dockerfile",
}


def git_short_sha() -> str:
    """
    입력: 없음.
    출력: 현재 HEAD의 짧은 커밋 해시.
    역할: 이미지 태그에 사용할 변경 기준을 계산한다.
    호출 예시: sha = git_short_sha()
    """
    # 변수 의미: git rev-parse 명령 실행 결과다.
    result = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def image_refs(registry: str, sha: str) -> dict[str, list[str]]:
    """
    입력: 레지스트리 주소와 짧은 커밋 해시.
    출력: 이미지별 sha/latest 태그 참조 목록.
    역할: 빌드와 푸시에 사용할 이미지 참조를 일관되게 만든다.
    호출 예시: refs = image_refs("questbook.kr.ncr.ntruss.com", "abc1234")
    """
    # 변수 의미: 끝 슬래시를 제거한 레지스트리 주소다.
    normalized_registry = registry.rstrip("/")
    return {
        name: [f"{normalized_registry}/{name}:{sha}", f"{normalized_registry}/{name}:latest"]
        for name in IMAGES
    }


def run_command(command: list[str], dry_run: bool) -> None:
    """
    입력: 실행할 명령 인자 목록과 dry-run 여부.
    출력: 없음.
    역할: 명령을 출력하고 dry-run이 아니면 실제로 실행한다.
    호출 예시: run_command(["docker", "push", image_ref], dry_run=True)
    """
    print("+", shlex.join(command))
    if dry_run:
        return

    subprocess.run(command, cwd=REPOSITORY_ROOT, check=True)


def parse_args() -> argparse.Namespace:
    """
    입력: 프로세스 명령행 인자.
    출력: 파싱된 argparse Namespace.
    역할: 이미지 빌드·푸시 스크립트 옵션을 정의한다.
    호출 예시: args = parse_args()
    """
    # 변수 의미: 명령행 옵션 파서다.
    parser = argparse.ArgumentParser(description="Questbook 이미지 빌드·푸시")
    parser.add_argument(
        "--registry",
        default=os.environ.get("NCP_CONTAINER_REGISTRY", ""),
        help="레지스트리 주소 (기본: NCP_CONTAINER_REGISTRY 환경 변수)",
    )
    parser.add_argument("--dry-run", action="store_true", help="명령을 출력만 한다")
    parser.add_argument("--skip-push", action="store_true", help="빌드만 하고 푸시하지 않는다")
    return parser.parse_args()


def main() -> int:
    """
    입력: 프로세스 명령행 인자와 환경 변수.
    출력: 프로세스 종료 코드.
    역할: Questbook web/app 이미지를 빌드하고 레지스트리에 푸시한다.
    호출 예시: uv run python scripts/build_push_images.py --registry questbook.kr.ncr.ntruss.com --dry-run
    """
    # 변수 의미: 파싱된 명령행 옵션이다.
    args = parse_args()
    if not args.registry:
        print("오류: --registry 또는 NCP_CONTAINER_REGISTRY가 필요합니다.", file=sys.stderr)
        return 1

    # 변수 의미: 현재 커밋 기준 이미지 태그다.
    sha = git_short_sha()
    # 변수 의미: 이미지별 sha/latest 태그 참조 목록이다.
    refs = image_refs(args.registry, sha)

    for name, dockerfile in IMAGES.items():
        # 변수 의미: 이 이미지에 붙일 docker build 태그 인자 목록이다.
        tag_arguments: list[str] = []
        for ref in refs[name]:
            tag_arguments += ["-t", ref]

        run_command(["docker", "build", "-f", dockerfile, *tag_arguments, "."], args.dry_run)
        if args.skip_push:
            continue

        for ref in refs[name]:
            run_command(["docker", "push", ref], args.dry_run)

    print(f"완료: 태그 {sha}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
