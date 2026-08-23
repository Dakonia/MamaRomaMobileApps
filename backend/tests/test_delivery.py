"""Зоны доставки: попадание точки в многоугольник и разбор адреса."""

from app.services.delivery import contains

# Простой квадрат: с ним видно и попадание, и промах, и границу
SQUARE = [[30.0, 59.0], [30.0, 60.0], [31.0, 60.0], [31.0, 59.0]]


def test_tochka_vnutri_zony():
    assert contains(SQUARE, longitude=30.5, latitude=59.5) is True


def test_tochka_snaruzhi_zony():
    assert contains(SQUARE, longitude=32.0, latitude=59.5) is False
    assert contains(SQUARE, longitude=30.5, latitude=61.0) is False


def test_pustoj_kontur_nikogo_ne_soderzhit():
    assert contains([], longitude=30.5, latitude=59.5) is False


def test_sosednyaya_zona_ne_zahvatyvaet_chuzhoe():
    """Две зоны рядом: адрес принадлежит только своей."""
    left = [[30.0, 59.0], [30.0, 60.0], [30.5, 60.0], [30.5, 59.0]]
    right = [[30.5, 59.0], [30.5, 60.0], [31.0, 60.0], [31.0, 59.0]]

    assert contains(left, longitude=30.2, latitude=59.5) is True
    assert contains(right, longitude=30.2, latitude=59.5) is False
