using System;

namespace Reservly.IikoFrontBridge;

internal sealed class ActionObserver<T> : IObserver<T>
{
    private readonly Action<T> _onNext;
    private readonly Action<Exception> _onError;

    public ActionObserver(Action<T> onNext, Action<Exception> onError = null)
    {
        _onNext = onNext;
        _onError = onError;
    }

    public void OnCompleted()
    {
    }

    public void OnError(Exception error)
    {
        if (_onError != null)
        {
            _onError(error);
        }
    }

    public void OnNext(T value)
    {
        _onNext(value);
    }
}
