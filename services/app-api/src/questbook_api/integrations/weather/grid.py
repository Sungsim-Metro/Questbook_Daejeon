# 위경도를 기상청 단기예보(getVilageFcst) 격자 좌표(nx, ny)로 바꾸는 순수 함수를 담는다.
from __future__ import annotations

import math


# 변수 의미: 기상청이 공개한 Lambert Conformal Conic 격자 변환 고정 상수다.
# (기상청 단기예보 조회서비스 활용가이드에 공개된 값으로, 외부 조회 없이 고정된다.)
_EARTH_RADIUS_KM = 6371.00877
_GRID_INTERVAL_KM = 5.0
_STANDARD_LATITUDE_1_DEG = 30.0
_STANDARD_LATITUDE_2_DEG = 60.0
_ORIGIN_LONGITUDE_DEG = 126.0
_ORIGIN_LATITUDE_DEG = 38.0
_ORIGIN_X_GRID = 43.0
_ORIGIN_Y_GRID = 136.0

_DEGREES_TO_RADIANS = math.pi / 180.0


def latlng_to_grid(latitude: float, longitude: float) -> tuple[int, int]:
    """
    입력: WGS84 위도·경도(도 단위).
    출력: 기상청 단기예보 격자 좌표 (nx, ny).
    역할: getVilageFcst가 요구하는 격자 좌표를 순수 수학 변환만으로 계산한다.
    호출 예시: nx, ny = latlng_to_grid(37.5665, 126.9780)  # 서울특별시청 -> (60, 127)
    """
    # 변수 의미: 격자 간격 단위로 정규화한 지구 반경이다.
    re = _EARTH_RADIUS_KM / _GRID_INTERVAL_KM
    slat1 = _STANDARD_LATITUDE_1_DEG * _DEGREES_TO_RADIANS
    slat2 = _STANDARD_LATITUDE_2_DEG * _DEGREES_TO_RADIANS
    olon = _ORIGIN_LONGITUDE_DEG * _DEGREES_TO_RADIANS
    olat = _ORIGIN_LATITUDE_DEG * _DEGREES_TO_RADIANS

    # 변수 의미: 원추 투영의 축척 계수다.
    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    # 변수 의미: 투영 스케일 계수다.
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = math.pow(sf, sn) * math.cos(slat1) / sn
    # 변수 의미: 기준점의 투영 반경이다.
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = re * sf / math.pow(ro, sn)

    # 변수 의미: 목표 좌표의 투영 반경이다.
    ra = math.tan(math.pi * 0.25 + latitude * _DEGREES_TO_RADIANS * 0.5)
    ra = re * sf / math.pow(ra, sn)
    # 변수 의미: 기준 경도 대비 회전각이다.
    theta = longitude * _DEGREES_TO_RADIANS - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn

    x = int(ra * math.sin(theta) + _ORIGIN_X_GRID + 0.5)
    y = int(ro - ra * math.cos(theta) + _ORIGIN_Y_GRID + 0.5)
    return x, y
