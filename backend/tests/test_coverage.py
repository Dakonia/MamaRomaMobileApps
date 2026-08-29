"""Общая граница доставки: слияние зон в один силуэт.

По этой границе гость решает, возите вы к нему или нет, поэтому дыр и лишних
кусков в ней быть не должно.
"""

from app.services.delivery import coverage

# Два перекрывающихся квадрата и один отдельный, далеко в стороне
LEFT = [[0.0, 0.0], [2.0, 0.0], [2.0, 2.0], [0.0, 2.0]]
RIGHT = [[1.0, 0.0], [3.0, 0.0], [3.0, 2.0], [1.0, 2.0]]
FAR = [[10.0, 10.0], [11.0, 10.0], [11.0, 11.0], [10.0, 11.0]]


def test_sosednie_zony_slivayutsya_v_odnu():
    """Перекрытие исчезает: вместо двух контуров получается один."""
    result = coverage([LEFT, RIGHT])

    assert len(result) == 1

    longitudes = [point[0] for point in result[0]]
    assert min(longitudes) == 0.0
    assert max(longitudes) == 3.0


def test_dalekaya_zona_ostaetsya_otdelnym_kuskom():
    """Район на отшибе не пририсовываем к городу перемычкой."""
    result = coverage([LEFT, FAR])

    assert len(result) == 2


def test_pustoy_spisok_daet_pustuyu_granitsu():
    assert coverage([]) == []


def test_ogryzki_ne_lomayut_slianie():
    """Контур из двух точек — не многоугольник, но падать из-за него нельзя."""
    result = coverage([LEFT, [[0.0, 0.0], [1.0, 1.0]]])

    assert len(result) == 1


def test_samopersekayushchiysya_kontur_perezhivaetsya():
    """После ручного рисования в админке попадаются восьмёрки."""
    bowtie = [[0.0, 0.0], [2.0, 2.0], [2.0, 0.0], [0.0, 2.0]]

    assert coverage([bowtie]) != []
